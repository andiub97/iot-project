const { json } = require('express/lib/response')
const mqtt = require('mqtt')
const influx = require('../influxdb/InfluxManager')
const request = require('request')

const hostMqtt = '192.168.1.159' // Broker Mosquitto
const portMqtt = '1883' // listen port for MQTT
const clientId = `diubi-esp-32` // subscriber id
const connectUrl = `mqtt://${hostMqtt}:${portMqtt}` // url for connection

// ----- OpenWeatherAPI metadata -----
const API_WEATHER_KEY = '6ce9db9e162494e26f2861ae54485b89';


// ------ Influx Data and Manager Setup ------
const InfluxData = {
    token: '0-boCREZ1XTzYhmT3RYogxFDtraRzOEZsMYNxjp0mBOWHCif47lUv2UddrAfyJUwupk33ci92-aHHFWhjv2pRg==',
    host: 'localhost',
    org: 'iot_group',
    port: 8086,
    buckets: {
        temp: 'temperature',
        aqi: 'aqi',
        hum: 'humidity',
        rss: 'rss',
        gas: 'gas',
    },
}

const influxManager = new influx.InfluxManager(InfluxData.host, InfluxData.port, InfluxData.token, InfluxData.org)


// connection on Mosquitto broker
var client = null

const sensor_data_temp = "sensor/data/temperature";
const sensor_data_hum = "sensor/data/humidity";
const sensor_data_rssi = "sensor/data/rssi";
const sensor_data_lat = "sensor/data/latitude";
const sensor_data_long = "sensor/data/longitude";
const sensor_data_gas = "sensor/data/gas";
const sensor_data_aqi = "sensor/data/aqi";

const switchTopic = "sensor/change/prot" // switch response channel to swap from CoAP to MQTT or vice versa
// const switchResponse = "sensor/change/prot" // sender channel to swap protocols
const changeVars = "sensor/change/vars";

const gps = {
    lat: 42.846290,
    lng: 13.904817
}

// ---------- Functions for MQTT -----------
init = () => {
    client = mqtt.connect(connectUrl, {
        clientId,
        username: 'diubi',
        password: 'diubi',
        clean: true,
        reconnectPeriod: 1000,
    })

    // reference name topic :-> name
    references = {}


    // mqtt handler
    client.on('connect', () => {
        console.log(`Listening in MQTT on ${hostMqtt}:${portMqtt}.`)
        console.log('---------------------')
        console.log('MQTT Subscriptions: ')
        try {
            client.subscribe(sensor_data_temp)
            client.subscribe(sensor_data_hum)
            client.subscribe(sensor_data_rssi)
            client.subscribe(sensor_data_lat)
            client.subscribe(sensor_data_long)
            client.subscribe(sensor_data_gas)
            client.subscribe(sensor_data_aqi)
            client.subscribe(switchTopic)
        } catch (e) {
            console.log('MQTT Error: ' + e)
        }
        console.log('Subscription to ', sensor_data_temp + ' : Success')
        console.log('Subscription to ', sensor_data_hum + '  : Success')
        console.log('Subscription to ', sensor_data_rssi + ' : Success')
        console.log('Subscription to ', sensor_data_lat + '  : Success')
        console.log('Subscription to ', sensor_data_long + ' : Success')
        console.log('Subscription to ', sensor_data_gas + '  : Success')
        console.log('Subscription to ', sensor_data_aqi + '  : Success')
        console.log('Subscription to ', switchTopic + '  : Success')
        console.log('---------------------')
    })


    client.on('message', (topic, payload) => {
        if (topic == sensor_data_temp) {
            console.log('MQTT: Trigger message on ' + topic)
            data = JSON.parse(payload.toString()) // stringify is used for different encoding string
            console.log(data)
            influxManager.writeApi(clientId, gps, "temperature", data)
            getOutdoorTemp().then(function (temp) {
                influxManager.writeApi(clientId, gps, "out_temperature", temp)
            })

        } else if (topic == sensor_data_hum) {
            console.log('MQTT: Trigger message on ' + topic)
            data = JSON.parse(payload.toString()) // stringify is used for different encoding string
            console.log(data)
            influxManager.writeApi(clientId, gps, "humidity", data)

        } else if (topic == sensor_data_gas) {
            console.log('MQTT: Trigger message on ' + topic)
            data = JSON.parse(payload.toString()) // stringify is used for different encoding string
            console.log(data)
            influxManager.writeApi(clientId, gps, "gas", data)

        } else if (topic == sensor_data_aqi) {
            console.log('MQTT: Trigger message on ' + topic)
            data = JSON.parse(payload.toString()) // stringify is used for different encoding string
            console.log(data)
            influxManager.writeApi(clientId, gps, "aqi", data)
        } else if (topic == sensor_data_rssi) {
            console.log('MQTT: Trigger message on ' + topic)
            data = JSON.parse(payload.toString()) // stringify is used for different encoding string
            console.log(data)
            influxManager.writeApi(clientId, gps, "rss", data)

        } else if (topic == switchTopic) {
            console.log('MQTT: Trigger message on ' + switchTopic)
            data = JSON.parse(payload.toString('utf-8'))
            console.log(data)
        }
    })
}

const switchMode = (request, response) => {
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
    const data = {
        minGas: request.body.minGas, // inverted related to data domain
        maxGas: request.body.maxGas, // inverted related to data domain
        sampleFrequency: request.body.sampleFrequency,
    }


    if (request.body.sampleFrequency < 5000) {
        data['sampleFrequency'] = 5000
    } else {
        data['sampleFrequency'] = request.body.sampleFrequency
    }

    // check data

    if (data.minGas > data.maxGas || (data.sampleFrequency == undefined || data.sampleFrequency == null || data.sampleFrequency < 5000)) {
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

        if (data.sampleFrequency != undefined && data.sampleFrequency != null) {
            console.log('HTTP: Received SAMPLE_FREQUENCY from the dashboard: ' + data.sampleFrequency)
        } else {
            data.sampleFrequency = -1
        }

        if (data.sampleFrequency != undefined && data.sampleFrequency > 0 && data.sampleFrequency != null) {
            id = data.id

            console.log('-----------------------------')
            success = forwardData(data) // forward on MQTT channels
            if (!success) {
                console.log('Error during publishing setup data')
            }
        }
    }
    response.status(200).json(data)
}

const httpData = (req) => {

    let data = req.body
    console.log(req.body)

    const clientId = "diubi-esp-32"
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
                console.log('It is currently ' + temp + ' degrees out.')
                resolve(temp)
            }
        })
    });
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
    switchMode,
    httpData,
    getOutdoorTemp,
    init,

}