const http = require('http');

const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', chunk => {
        data += chunk;
    });
    req.on('end', () => {
        console.log(data); // 'Buy the milk'
        res.end();
    });
});


server.listen(8080);