/**
 * MIT License
 *
 * Copyright (c) 2020 Anonymous
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
/**
 * MIT License
 *
 * Copyright (c) 2020 Did
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const http = require('http');
const https = require('https');
const url = require('url');
const querystring = require('querystring');
const cliProgress = require('cli-progress');
const argv = require('yargs')
  .usage('Usage: node $0 -s [URL] -d [URL] [--no-ssl-validation]')
  .example(
    'node $0 -s https://myetcd.example.com:2379 -d http://localhost:2379 --no-ssl-validation'
  )
  .boolean(['no-ssl-validation'])
  .alias('s', 'source')
  .describe('s', 'Source etcd url')
  .alias('d', 'dest')
  .describe('d', 'Destination etcd url')
  .describe('no-ssl-validation', 'disable ssl certificate validation')
  .demandOption(['s', 'd']).argv;

const source = argv.s;
const dest = argv.d;

console.log(argv.sslValidation === false);

if (argv.sslValidation === false) {
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;
}

const multibar = new cliProgress.MultiBar(
  {
    clearOnComplete: false,
    hideCursor: false,
  },
  cliProgress.Presets.shades_classic
);
let uploadProgressBar;

const getHTTPClient = (targetUrl) => {
  const { protocol } = url.parse(targetUrl);
  return protocol === 'https' ? https : http;
};

const get_source = (source, source_key, cb) => {
  const request = getHTTPClient(source);

  request.get(`${source}/v2/keys${source_key}?recursive=true`, (res) => {
    const { statusCode } = res;
    const contentType = res.headers['content-type'];
    const downloadProgressBar = multibar.create(8192, 0);

    if (statusCode !== 200) {
      throw new Error('Request Failed.\n' + `Status Code: ${statusCode}`);
    } else if (!/^application\/json/.test(contentType)) {
      throw new Error(
        'Invalid content-type.\n' +
          `Expected application/json but received ${contentType}`
      );
    }
    res.setEncoding('utf8');
    let rawData = '';
    res.on('data', (chunk) => {
      rawData += chunk;
      const size = rawData.length;
      downloadProgressBar.setTotal(size);
      downloadProgressBar.update(size);
    });
    res.on('end', () => {
      const parsedData = JSON.parse(rawData).node;
      const size = rawData.length;
      downloadProgressBar.setTotal(size);
      downloadProgressBar.update(size);
      cb(parsedData);
      uploadProgressBar = multibar.create(sent_count, 0);
    });
  });
};
let done_count = 0;
let sent_count = 0;

const create_destination_updater = (destination) => {
  const base_url = `${destination}/v2/keys`;
  const request = getHTTPClient(destination);

  const agent = new request.Agent({ maxSockets: 10 });

  return (key, value = undefined, dir = false, ttl = 0) => {
    // dir: curl http://127.0.0.1:2379/v2/keys/dir -XPUT -d dir=true
    // key: curl http://127.0.0.1:2379/v2/keys/message -XPUT -d value="Hello world"

    if (!key) {
      throw new Error(`key is required: ${key}`);
    }
    sent_count += 1;

    let data = {
      dir,
      value,
      // prevExist: false,
    };

    if (ttl > 0) {
      data.ttl = ttl;
    }
    const postData = querystring.stringify(data);

    const url = `${base_url}${key}`;

    const req = request.request(
      url,
      {
        agent,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        const { statusCode, headers } = res;
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          done_count += 1;
          uploadProgressBar.update(done_count);
          if (done_count === sent_count) {
            multibar.stop();
          }
          if (statusCode > 299) {
            if (dir && statusCode == 403) {
              try {
                response = JSON.parse(rawData);
                if (response.errorCode == 102) {
                  return; //if we try to create a folder that already exists we get a 102 error, not sure why, so just ignoring it.
                }
              } catch (error) {
                console.error(
                  `set_on_dist(key=${key}, value=${value}, dir=${dir}, ttl=${ttl}) => JSON.parse(${rawData}): ${error}`
                );
              }
            }
            throw new Error(
              `received ${statusCode} for ${url} ${JSON.stringify(
                data,
                null,
                '\t'
              )} response: ${rawData}`
            );
          }
        });

        res.resume();
      }
    );
    // Write data to request body
    req.write(postData);
    req.end();
  };
};
const set_on_dest = create_destination_updater(dest);

const copy = (data) => {
  data.forEach(process_source_data);
};

const process_source_data = (data) => {
  if (data.key) {
    set_on_dest(data.key, data.value, data.dir, data.ttl);
  }
  if (data.dir && data.nodes && data.nodes.length > 0) {
    copy(data.nodes);
  }
};

// manual test from a json dump of prod db
// process_source_data(JSON.parse(fs.readFileSync("./vettel-etcd-1-dump-20200430.json"))
//   .node);

get_source(source, '/', process_source_data);
