/**
 * app.js is the main module for the proxy server, it is composed by the main communications and API for the sensors and back-end components interconnection. 
 */
// -------- Dependencies --------
const express = require('express')
const http = require('http')
const prots = require('./protocols')
const bodyParser = require('body-parser')
const swaggerUi = require('swagger-ui-express')
const swaggerFile = require('../swagger_output.json')
require('dotenv').config({ path: '../.env' })

// --------- MQTT setup -------------
prots.init()


// ----- Express setup -----
const portHttp = process.env.SERVER_PORT
const host = process.env.SERVER_HOST
const app = express()


// bodyParser for POST
app.use(bodyParser.json())
app.use(
    bodyParser.urlencoded({
        extended: true,
    })
)

http.createServer(app).listen(80)

// static directory used to the app
app.use(express.static(__dirname + "/public", {
    index: false,  // no index
    immutable: true,  // immutable static files
    cacheControl: true, // always in cache
    maxAge: "30d" // death time
}));

app.use('/doc', swaggerUi.serve, swaggerUi.setup(swaggerFile))

// update data for sensor via http protocol
app.post('/update-setup', prots.updateSetup)

// switch mode
app.post('/switch-prot-mode', prots.switchProtMode)

// switch mode
app.post('/switch-eval-mode', prots.switchEvalMode)

// info packages
app.post('/info-packages', prots.infoPackagesHTTP)

app.post('/data', prots.httpData)

app.post('/newTelegramUser', prots.getNewUsers)

app.post('/aqi_alert', prots.sendAlertMessageTelegram)

// listening on http
app.listen(portHttp, host, () => {
    console.log(`Listening in HTTP  on ${host}:${portHttp}.`)
})