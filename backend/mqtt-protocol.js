const { json } = require('express/lib/response')
const mqtt = require('mqtt')
//const influx = require('../influxdb/InfluxManager')
const http = require('http')
// Server session variables
var idValues = []

const hostMqtt = '192.168.43.177' // Broker Mosquitto
const portMqtt = '1883' // listen port for MQTT
const clientId = `proxy_${Math.random().toString(16).slice(3)}` // subscriber id
const connectUrl = `mqtt://${hostMqtt}:${portMqtt}` // url for connection

// connection on Mosquitto broker
var client = null

const sensor_data_temp = "sensor/data/temperature";
const sensor_data_hum = "sensor/data/humidity";
const sensor_data_rssi = "sensor/data/rssi";
const sensor_data_lat = "sensor/data/latitude";
const sensor_data_long = "sensor/data/longitude";
const sensor_data_gas = "sensor/data/gas";
const sensor_data_aqi = "sensor/data/aqi";
const sensor_data_all = "sensor/data/.*"

const switchTopic = "sensor/change/prot" // switch response channel to swap from CoAP to MQTT or vice versa
// const switchResponse = "sensor/change/prot" // sender channel to swap protocols
const changeVars = "sensor/change/vars";

var sensor = {} // JSON with elements of the session (pushed to the dashboard)

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
            console.log(data);
            processJSON(data)
        } else if (topic == sensor_data_hum) {
            console.log('MQTT: Trigger message on ' + topic)
            data = JSON.parse(payload.toString()) // stringify is used for different encoding string
            console.log(data);
            processJSON(data)
        } else if (topic == sensor_data_gas) {
            console.log('MQTT: Trigger message on ' + topic)
            data = JSON.parse(payload.toString()) // stringify is used for different encoding string
            console.log(data);
            processJSON(data)
        } else if (topic == sensor_data_lat) {
            console.log('MQTT: Trigger message on ' + topic)
            data = JSON.parse(payload.toString()) // stringify is used for different encoding string
            console.log(data);
            processJSON(data)
        } else if (topic == sensor_data_long) {
            console.log('MQTT: Trigger message on ' + topic)
            data = JSON.parse(payload.toString()) // stringify is used for different encoding string
            console.log(data);
            processJSON(data)
        } else if (topic == sensor_data_gas) {
            console.log('MQTT: Trigger message on ' + topic)
            data = JSON.parse(payload.toString()) // stringify is used for different encoding string
            console.log(data);
            processJSON(data)
        } else if (topic == sensor_data_aqi) {
            console.log('MQTT: Trigger message on ' + topic)
            data = JSON.parse(payload.toString()) // stringify is used for different encoding string
            console.log(data);
            processJSON(data)
        } else if (topic == switchTopic) {
            console.log('MQTT: Trigger message on ' + switchTopic)
            //data = JSON.parse(payload.toString('utf-8'))

            // id = data.id
            // if (checkId(id)) {
            //     sensors[id]['protocol'] = data.protocol
            //     isPresent = true
            // }

            // if (isPresent) {
            //     console.log('MQTT: Switch response for sensor: ' + id + "\nSaved in session.")
            // } else {
            //     console.log('MQTT: Sensor not in session during invoking of ' + switchResponse + ' for sensor ' + data.id)
            // }
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
        minGas: request.body.maxGas, // inverted related to data domain
        maxGas: request.body.minGas, // inverted related to data domain
        sampleFrequency: request.body.sampleFrequency,
    }


    if (request.body.sampleFrequency < 5000) {
        sensor['sampleFrequency'] = 5000
    } else {
        sensor['sampleFrequency'] = request.body.sampleFrequency
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
    response.status(200).json(sensor)
}

const getProtocol = (request, response) => {
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


const processJSON = (data) => {

    sensor = {
        protocol: data['protocol'], // protocol
        sampleFrequency: data['samF'], // current sample frequency
        lastTime: Date.now(), // timestamp for the testing phase in ms
        timestamp: Date.now(), // is equal in timestamp of the server
        status: 1, // 1 connected, 0 disconnected
    }

    // update values
    sensor['protocol'] = data['protocol']
    if (sensor['sampleFrequency'] != data['samF']) {
        request.get(
            'http://localhost:5000/changeFreq/' + data['samF'],
            { json: {} },
            function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    // given data in the body, we want to add them in the next datetime according to the sensor sample frequency
                    console.log('FLASK: Changed sample frequency with frequency at ' + data['samF'])
                }
            }
        );
    }
    sensor['sampleFrequency'] = data['samF']
    sensor['gps'] = data['gps']
    sensor['timestamp'] = Date.now()







    // Write on InfluxDB
    // const influxId = data['id']
    // const gps = data['gps']
    // for (const [key, value] of Object.entries(InfluxData.buckets)) {
    //     if (key == "temp" || key == "gas" || key == "hum") {
    //         console.log('Forecast: Sending request to: ' + 'http://localhost:5000/forecast/' + predLen + '/' + idJSON + "/" + key + "/" + sensors[idJSON]['sampleFrequency'])
    //         request.get(
    //             'http://localhost:5000/forecast/' + predLen + '/' + idJSON + "/" + key + "/" + sensors[idJSON]['sampleFrequency'],
    //             { json: {} },
    //             function (error, response, body) {
    //                 if (!error && response.statusCode == 200) {
    //                     // given data in the body, we want to add them in the next datetime according to the sensor sample frequency
    //                     influxManager.writeForecastApi(influxId, gps, body, value, sensors[idJSON]['sampleFrequency'])
    //                 }
    //             }
    //         );
    //     }
    //     switch (value) {
    //         case "temperature": influxManager.writeApi(influxId, gps, value, data['temp'])
    //             break;
    //         case "humidity": influxManager.writeApi(influxId, gps, value, data['hum'])
    //             break;
    //         case "gas": influxManager.writeApi(influxId, gps, value, data['gasv']['gas'])
    //             break;
    //         case "aqi": influxManager.writeApi(influxId, gps, value, data['gasv']['AQI'])
    //             break;
    //         case "rss": influxManager.writeApi(influxId, gps, value, data['rss'])
    //             break;
    //         default:
    //             break;
    //     }
    // }

    // Adding external temperature
    // let latitude = data.gps.lat
    // let longitude = data.gps.lng
    // var url = `http://api.openweathermap.org/data/2.5/weather?`
    //     + `lat=${latitude}&lon=${longitude}&appid=${API_WEATHER_KEY}`
    // request({ url: url, json: true }, function (error, response) {
    //     if (error) {
    //         console.log('METEO-STAT: Unable to connect to Forecast API');
    //     }
    //     else {
    //         let temp = Math.round(response.body.main.temp - 273.15, 2) // convert in celsius
    //         let bucket = InfluxData.buckets.tempout
    //         influxManager.writeApi(influxId, gps, bucket, temp)
    //     }
    // })

    // console.log('---------------------')

}


// module export 
module.exports = {

    processJSON,
    updateSetup,
    switchMode,
    init,

}