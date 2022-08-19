const http = require('http');

const portHttp = 8081
const host = '127.0.0.1'
const http_server = express()

// app.use(express.static(__dirname + "/public", {
//     index: false,  // no index
//     immutable: true,  // immutable static files
//     cacheControl: true, // always in cache
//     maxAge: "30d" // death time
// }));

const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', chunk => {
        data += chunk;
    });
    req.on('end', () => {
        console.log(data);
        res.end();
    });
});


server.listen(8081);