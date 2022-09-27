const { json } = require('express/lib/response')
const mqtt = require('mqtt')
const http = require('http')
const https = require('https')
const influx = require('../influxdb/InfluxManager')
const request = require('request')
const fs = require('fs')
require('dotenv').config({ path: '../.env' })


const hostMqtt = process.env.MQTT_HOST // Broker Mosquitto
const portMqtt = process.env.MQTT_PORT // listen port for MQTT
const clientId = process.env.SENSOR_CLIENT_ID // subscriber id
const connectUrl = `mqtt://${hostMqtt}:${portMqtt}` // url for connection

// ----- OpenWeatherAPI metadata -----
const API_WEATHER_KEY = process.env.OPEN_WEATHER_KEY;


// ------ Influx Data and Manager Setup ------
const InfluxData = {
    token: process.env.INFLUX_TOKEN,
    host: process.env.INFLUX_HOST,
    org: process.env.INFLUX_ORG,
    port: process.env.INFLUX_HOST_PORT,
    buckets: {
        temp: 'temperature',
        out_temp: 'out_temperature',
        aqi: 'aqi',
        hum: 'humidity',
        rss: 'rss',
        gas: 'gas',
    },
}

const influxManager = new influx.InfluxManager(InfluxData.host, InfluxData.port, InfluxData.token, InfluxData.org)


// connection on Mosquitto broker
var client = null

const sensor_data_all = "sensor/data/all";


const switchTopic = "sensor/change/prot" // switch response channel to swap from CoAP to MQTT or vice versa
const evaluationMode = "sensor/change/eval_mode";
const changeVars = "sensor/change/vars";

const gps = {
    lat: process.env.GPS_LAT,
    lng: process.env.GPS_LONG
}

// ---------- Functions for MQTT -----------
init = () => {
    client = mqtt.connect(connectUrl, {
        clientId,
        username: process.env.MQTT_USER,
        password: process.env.MQTT_PASS,
        clean: true,
        reconnectPeriod: 1000,
    })

    // createAQICheck()

    // reference name topic :-> name
    references = {}


    // mqtt handler
    client.on('connect', () => {
        console.log(`Listening in MQTT on ${hostMqtt}:${portMqtt}.`)
        console.log('---------------------')
        console.log('MQTT Subscriptions: ')
        try {
            client.subscribe(sensor_data_all)
            client.subscribe(switchTopic)
        } catch (e) {
            console.log('MQTT Error: ' + e)
        }
        console.log('Subscription to ', sensor_data_all + ' : Success')
        console.log('Subscription to ', switchTopic + '  : Success')
        console.log('---------------------')
    })


    client.on('message', (topic, payload) => {
        if (topic == sensor_data_all) {
            // console.log('MQTT: Trigger message on ' + topic)
            data = JSON.parse(payload.toString()) // stringify is used for different encoding string
            console.log(data)
            const gps = data.gps
            for (const [key, value] of Object.entries(InfluxData.buckets)) {

                switch (value) {
                    case "temperature":
                        influxManager.writeApi(clientId, gps, value, data.temp)
                        getOutdoorTemp().then(function (temp) {
                            influxManager.writeApi(clientId, gps, "out_temperature", temp)
                        })
                        break;
                    case "humidity": influxManager.writeApi(clientId, gps, value, data.hum)
                        break;
                    case "gas": influxManager.writeApi(clientId, gps, value, data.gasv.gas)
                        break;
                    case "aqi": influxManager.writeApi(clientId, gps, value, data.gasv.AQI)
                        break;
                    case "rss": influxManager.writeApi(clientId, gps, value, data.rss)
                        break;
                    default:
                        break;
                }

            }


        } else if (topic == switchTopic) {
            console.log('MQTT: Trigger message on ' + switchTopic)
            data = JSON.parse(payload.toString('utf-8'))
            console.log(data)
        }
    })
}

const switchProtMode = (request, response) => {
    console.log('Invoke Switching Mode...')

    let prot = request.body.protocol
    console.log(prot);

    if (prot == 0 || prot == 1) {
        var switched;
        if (prot == 0) {
            switched = 1
        } else {
            switched = 0
        }
        // get data from the body
        let json = {
            protocol: switched,
        }

        // publish data on sensors network
        client.publish(switchTopic, JSON.stringify(json), { qos: 1 }, (e) => {
            if (e) {
                console.log('Error during publishing on ' + switchTopic)
            } else {
                console.log('Publish successful on ' + switchTopic)
            }
        })
    } else {
        console.log('Switch Mode: Error, protocol value are not acceptable.')
        response.status(500).json(json)
    }
    // send response
    response.status(200).json(json)
}


const updateSetup = (request, response) => {
    console.log('HTTP: Update data received...')
    console.log('-----------------------------')
    sensor = [];
    const data = {
        minGas: request.body.minGas, // inverted related to data domain
        maxGas: request.body.maxGas, // inverted related to data domain
        sampleFrequency: request.body.sampleFrequency,
    }
    // check data

    if (data.minGas > data.maxGas || (data.sampleFrequency == undefined || data.sampleFrequency == null || data.sampleFrequency < 1000)) {
        console.log('HTTP Error: Invalid values received.')
        response.json({ status: 400 })
        console.log('-----------------------------')
    }

    else {

        if (data.minGas != undefined && data.minGas != null) {
            console.log('HTTP: Received MIN_GAS_VALUE from the dashboard: ' + data.maxGas)
        } else {
            data.minGas = -1;
        }

        if (data.maxGas != undefined && data.maxGas != null) {
            console.log('HTTP: Received MAX_GAS_VALUE from the dashboard: ' + data.maxGas)
        } else {
            data.maxGas = -1
        }

        console.log('HTTP: Received SAMPLE_FREQUENCY from the dashboard: ' + data.sampleFrequency)
        console.log('-----------------------------')
        success = forwardData(data) // forward on MQTT channels
        if (!success) {
            console.log('Error during publishing setup data')
        }
    }
    response.status(200).json(data)
}

const switchEvalMode = (request, response) => {

    var mode = request.body.mode


    if (mode == 0 || mode == 1) {

        // get data from the body
        let json = {
            mode: mode,
        }

        // publish data on sensors network
        client.publish(switchTopic, JSON.stringify(json), { qos: 1 }, (e) => {
            if (e) {
                console.log('Error during publishing on ' + evaluationMode)
            } else {
                console.log('Publish successful on ' + evaluationMode)
            }
        })
    } else {
        console.log('Switch Mode: Error, evaluation mode value are not acceptable.')
        response.status(500).json(json)
    }
    // send response
    response.status(200).json(json)
}




const httpData = (req, response) => {

    let data = req.body
    console.log(req.body)

    const gps = data.gps
    for (const [key, value] of Object.entries(InfluxData.buckets)) {

        switch (value) {
            case "temperature":
                influxManager.writeApi(clientId, gps, value, data.temp)
                getOutdoorTemp().then(function (temp) {
                    influxManager.writeApi(clientId, gps, "out_temperature", temp)
                })
                break;
            case "humidity": influxManager.writeApi(clientId, gps, value, data.hum)
                break;
            case "gas": influxManager.writeApi(clientId, gps, value, data.gasv.gas)
                break;
            case "aqi": influxManager.writeApi(clientId, gps, value, data.gasv.AQI)
                break;
            case "rss": influxManager.writeApi(clientId, gps, value, data.rss)
                break;
            default:
                break;
        }

    }
    response.status(200).json(data);

}

function getOutdoorTemp() {

    var url = `http://api.openweathermap.org/data/2.5/weather?`
        + `lat=${gps.lat}&lon=${gps.lng}&appid=${API_WEATHER_KEY}`

    return new Promise(function (resolve, reject) {

        request({ url: url, json: true }, function (error, response) {
            if (error) {
                console.log('Unable to connect to Forecast API');
                reject(error)
            }
            else {
                let avg_temp = (response.body.main.temp_max + response.body.main.temp_min) / 2
                let temp = Math.round((avg_temp - 273.15), 2)
                // console.log('It is currently ' + temp + ' degrees out.')
                resolve(temp)
            }
        })
    });
}

function createAQICheck() {

    const data = influxManager.AQICheckBody()
    const options = {
        hostname: `localhost`,
        port: InfluxData.port,
        path: '/api/v2/checks',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Token ${InfluxData.token}`
        },
    };

    const req = http.request(options, res => {
        console.log(`statusCode: ${res.statusCode}`);

        res.on('data', d => {
            process.stdout.write(d);
        });
    });

    req.on('error', error => {
        console.error(error);
    });

    req.write(data);
    req.end();

}



const getNewUsers = (req) => {
    console.log(req.body);

    fs.readFile('../telegram_file.json', function (error, data) {

        if (error) {
            throw error;
        }
        const content = JSON.parse(data)
        console.log(content)
        let res = writeContent(content)
        fs.writeFile("../telegram_file.json", JSON.stringify(res), function (err) {
            if (err) {
                console.log("error ", err);
            }
        })

    });

    function writeContent(content) {

        var flag = false

        for (i = 0; i < content.length; i++) {
            var update_id = content[i].update_id
            if (update_id === req.body.update_id) {
                flag = true

            }
        }
        if (flag === false || content.length === 0) {
            content.push({
                "update_id": req.body.update_id,
                "chat_id": req.body.message.chat.id
            })
        }
        return content

    }


}

const sendAlertMessageTelegram = (req) => {

    const data = fs.readFileSync('../telegram_file.json');
    const list = JSON.parse(data);
    const message = req.body._message
    for (i = 0; i < list.length; i++) {
        sendReq(list[i].chat_id, message)

    }


}

function sendReq(id, mess) {
    options = {
        hostname: 'api.telegram.org',
        path: `/bot${process.env.ALERT_BOT_KEY}/sendMessage?chat_id=${id}&text=${mess}`,
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    }

    const r = https.request(options, res => {
        console.log(`statusCode: ${res.statusCode}`);

        res.on('data', d => {
            process.stdout.write(d);
        });
    })


    r.on('error', error => {
        console.error(error);
    });

    r.end();
}


/**
 * forwardData(request, response) forwards the setup information to sensor via MQTT
 * @param data is not considered
 * @return true in case of good forwarding, false otherwise
 */
forwardData = (data) => {
    if (client == null) {
        console.log('Error, no sensors connected.')
        return false
    }
    console.log(data)

    client.publish(
        changeVars,
        JSON.stringify(data),
        { qos: 1, retain: true },
        (e) => {
            if (e) {
                return false;
            } else {
                console.log('MQTT: Published with success on the setup topic.')
                return true;
            }
        })
    return true;
}



// module export 
module.exports = {

    updateSetup,
    switchProtMode,
    switchEvalMode,
    httpData,
    getOutdoorTemp,
    getNewUsers,
    sendAlertMessageTelegram,
    init,

}