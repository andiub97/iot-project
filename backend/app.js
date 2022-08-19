/**
 * app.js is the main module for the proxy server, it is composed by the main communications and API for the sensors and back-end components interconnection. 
 * It provides a front-end dashboard with notification channel on socketio via HTTP and internal multicasting communication with sensors in MQTT and CoAP within 
 * testing modes and forwarding mechanics with InfluxDB and Grafana.
 */


// -------- Dependencies --------
const express = require('express')
const http = require('http')
const mqtt_prot = require('./mqtt-protocol')
const bodyParser = require('body-parser')

// --------- MQTT setup -------------
mqtt_prot.init()


// ----- Express setup -----

const portHttp = 8080
const host = '127.0.0.1'
const app = express()

// bodyParser for POST
app.use(bodyParser.json())
app.use(
    bodyParser.urlencoded({
        extended: true,
    })
)

// static directory used to the app
app.use(express.static(__dirname + "/public", {
    index: false,  // no index
    immutable: true,  // immutable static files
    cacheControl: true, // always in cache
    maxAge: "30d" // death time
}));

// Http API
// default API for setup tool
// app.get("/", (request, response) => {
//     response.sendFile(path.join(__dirname, '../frontend/dashboard.html'));
// })

// app.get('/map', (request, response) => {
//     response.sendFile(path.join(__dirname, '../frontend/map.html'))
// })

// // Retrieve connected sensors ids
// 
// // updating prediction length for forecasting 
// app.post('/updatePredLen', protocols.updatePredLen)

// // register a new node as a device for the IoT network
// app.post('/registerModel', protocols.registerModel)

// // register a new node as a device for the IoT network
// app.post('/registerNode', protocols.registerNode)

// update data for sensor via http protocol
app.post('/update-setup', mqtt_prot.updateSetup)

// switch mode
app.post('/switch-mode', mqtt_prot.switchMode)

// listening on http
app.listen(portHttp, host, () => {
    console.log(`Listening in HTTP  on ${host}:${portHttp}.`)

})


const data = JSON.stringify({
    protocol: 0,
});

const options = {
    host: '127.0.0.1',
    port: 8080,
    path: '/switch-mode',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
    },
};

const req = http.request(options, res => {
    console.log(`statusCode: ${res.statusCode}`);

    res.on('data', function (chunk) {
        console.log('Response: ' + chunk + '\n');
    });

    req.write(data);
    req.end();
})
