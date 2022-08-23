/**
 * app.js is the main module for the proxy server, it is composed by the main communications and API for the sensors and back-end components interconnection. 
 * It provides a front-end dashboard with notification channel on socketio via HTTP and internal multicasting communication with sensors in MQTT and CoAP within 
 * testing modes and forwarding mechanics with InfluxDB and Grafana.
 */


// -------- Dependencies --------
const express = require('express')
const http = require('http')
const prots = require('./protocols')
const bodyParser = require('body-parser')
const influx = require('../influxdb/InfluxManager')
// --------- MQTT setup -------------
prots.init()


// ----- Express setup -----

const portHttp = 8080
const host = '127.0.0.1'
const app = express()

const influxManager = new influx.InfluxManager(InfluxData.host, InfluxData.port, InfluxData.token, InfluxData.org)


// bodyParser for POST
app.use(bodyParser.json())
app.use(
    bodyParser.urlencoded({
        extended: true,
    })
)

http.createServer(app).listen(8080)

// static directory used to the app
app.use(express.static(__dirname + "/public", {
    index: false,  // no index
    immutable: true,  // immutable static files
    cacheControl: true, // always in cache
    maxAge: "30d" // death time
}));

// update data for sensor via http protocol
app.post('/update-setup', prots.updateSetup)

// switch mode
app.post('/switch-mode', prots.switchMode)

app.post('/data', function (req, res) {

    console.log(req.body)


})

// listening on http
app.listen(portHttp, host, () => {
    console.log(`Listening in HTTP  on ${host}:${portHttp}.`)
})