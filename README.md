# etcd2etcd

Reads all key/value pairs from a source etcd cluster and writes them into a destination etcd cluster.

Uses ETCD V2 API only.

Inspired from https://github.com/minyk/etcd2etcd.

## usage

Clone this repo and run `npm install`.

```bash
node index.js -s https://myetcd.example.com:2379 -d http://localhost:2379 --no-ssl-validation
```
