const { json } = require('express/lib/response')
const mqtt = require('mqtt')
const influx = require('../influxdb/InfluxManager')
const http = require('http')
// Server session variables
var idValues = []

const hostMqtt = '192.168.43.177' // Broker Mosquitto
const portMqtt = '1883' // listen port for MQTT
const clientId = `proxy_${Math.random().toString(16).slice(3)}` // subscriber id
const connectUrl = `mqtt://${hostMqtt}:${portMqtt}` // url for connection

// connection on Mosquitto broker
var client = null
const setupTopic = "sensor/1175/setup" // setup ESP32 metadata
const topicMqtt = 'sensor/1175/data' // listener MQTT topic for the topic 
const switchTopic = "sensor/1175/switchRequest" // switch response channel to swap from CoAP to MQTT or vice versa
const switchResponse = "sensor/1175/switch" // sender channel to swap protocols

// ---------- Functions for MQTT -----------
init = () => {
    client = mqtt.connect(connectUrl, {
        clientId,
        clean: true,
        connectTimeout: 4000,
        username: 'iot2020',
        password: 'mqtt2020*',
        reconnectPeriod: 1000,
    })

    // reference name topic :-> name
    references = {}

    // topic setup

    // mqtt handler
    client.on('connect', () => {
        console.log(`Listening in MQTT on ${hostMqtt}:${portMqtt}.`)
        console.log('---------------------')
        console.log('MQTT Subscriptions: ')
        try {
            client.subscribe(topicMqtt) // 
            client.subscribe(consumerTestMqtt) // for testing mode on MQTT sensors receiving the response
            client.subscribe(switchResponse) // for a case of response in switchMode or manual setting on the sensor
        } catch (e) {
            console.log('MQTT Error: ' + e)
        }
        console.log('Subscription to', topicMqtt + ' : Success')
        console.log('---------------------')
    })


    client.on('message', (topic, payload) => {
        if (topic == topicMqtt) {
            console.log('MQTT: Trigger message on ' + topicMqtt)
            data = JSON.parse(payload.toString()) // stringify is used for different encoding string
            processJSON(data)
        }

        if (topic == consumerTestMqtt) {
            console.log('MQTT: Trigger message on ' + consumerTestMqtt)
            try {
                data = JSON.parse(payload.toString())
                console.log(data)
                isPresent = false
                id = data.id
                if (checkId(id)) {
                    sensors[id]['mqtt'] = data.time
                    isPresent = true
                }

                if (isPresent) {
                    console.log('MQTT: Testing response for sensor: ' + data.id + "\nSaved in session.")

                } else {
                    console.log('MQTT: Sensor not in session during invoking of ' + consumerTestMqtt + ' for sensor ' + data.id)

                }
            } catch (e) {
                console.log('MQTT: Wrong formatting on ' + consumerTestMqtt + ' for sensor ' + data.id)
            }
        }

        if (topic == switchResponse) {
            console.log('MQTT: Trigger message on ' + switchResponse)
            data = JSON.parse(payload.toString())
            isPresent = false
            id = data.id
            if (checkId(id)) {
                sensors[id]['protocol'] = data.protocol
                isPresent = true
            }

            if (isPresent) {
                console.log('MQTT: Switch response for sensor: ' + id + "\nSaved in session.")
            } else {
                console.log('MQTT: Sensor not in session during invoking of ' + switchResponse + ' for sensor ' + data.id)
            }
        }
    })
}

const switchMode = (request, response) => {
    console.log('Invoke Switching Mode...')
    let id = request.body.id
    let protocol = request.body.protocol
    let ip = request.body.ip

    if (protocol == 0 || protocol == 1) {
        var switched;
        if (protocol == 0) {
            switched = 1
            requestCoAP[id] = setInterval(() => {
                if (sensors[id] != undefined) {
                    if (sensors[id]['protocol'] == 1) {
                        console.log('Send request.')
                        const req = coap.request('coap://' + sensors[id]['ip'] + '/data', { observe: true })
                        if (sensors[id]['mode'] != undefined && sensors[id]['mode'] == 1) {
                            // we are in the testing mode for the coap sensor
                            if (sensors[id]['counterTest'] == undefined) {
                                // first request
                                sensors[id]['numPackage'] = 1
                                sensors[id]['counterTest'] = 0
                                sensors[id]['packagesTime'] = Date.now()
                                sensors[id]['testingParams'] = [0, 0, 0, 0, 0] // list of time in the response
                                sensors[id]['testingParams'][sensors[id]['counterTest']] = Date.now() // first request, got the first response
                            } else {
                                // other requests
                                sensors[id]['numPackage'] += 1
                                sensors[id]['testingParams'][sensors[id]['counterTest']] = Date.now() // last request for response i

                            }
                        }
                        req.on('response', (res) => {
                            now = Date.now()
                            processJSON(JSON.parse(res.payload.toString()))
                            if (sensors[id]['mode'] != undefined && sensors[id]['mode'] == 1) {
                                if (sensors[id]['counterTest'] != undefined && sensors[id]['testingParams'] != undefined &&
                                    sensors[id]['counterTest'] < 5 && sensors[id]['mode'] != undefined && sensors[id]['mode'] == 1) {
                                    sensors[id]['testingParams'][sensors[id]['counterTest']] = now - sensors[id]['testingParams'][sensors[id]['counterTest']]
                                    sensors[id]['counterTest'] = sensors[id]['counterTest'] + 1 // 1 to n 

                                } else if (sensors[id]['counterTest'] != undefined && sensors[id]['testingParams'] != undefined && sensors[id]['counterTest'] == 5) {
                                    let numPackage = sensors[id]['numPackage']
                                    sensors[id]['testingParams'][sensors[id]['counterTest']] = now - sensors[id]['testingParams'][sensors[id]['counterTest']]
                                    sensors[id]['counterTest'] = undefined
                                    sensors[id]['packageTime'] = undefined
                                    sensors[id]['numPackage'] = undefined
                                    let array = sensors[id]['testingParams']
                                    let sum = 0
                                    for (let i = 0; i < array.length; i++) {
                                        sum += array[i]
                                    }
                                    sensors[id]['coap'] = Math.floor(sum / 5)
                                    console.log('Package sent: ' + numPackage)
                                    console.log('Package received: 5')
                                    sensors[id]['packageLossCoAP'] = 100 - Math.round(5 * 100 / numPackage, 2)
                                    console.log('Latency on communication: ' + sensors[id]['coap'])
                                    console.log('CoAP Loss Package: ' + sensors[id]['packageLossCoAP'] + " %")
                                    sensors[id]['mode'] = 0
                                }

                            }
                            res.on('end', () => {
                                //
                            })
                        })

                        req.on('error', (e) => {
                            // do nothing
                        })
                        req.end()
                    }
                }
            }, sensors[id]['sampleFrequency'])

        } else {
            switched = 0
            clearInterval(requestCoAP[id])
            requestCoAP[id] = undefined
        }

        // get data from the body
        let json = {
            id: id,
            ip: ip,
            protocol: switched,
            sampleFrequency: sensors[id]['sampleFrequency']
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
    // update sensor session data
    if (checkId(id)) {
        sensors[id]['protocol'] = switched
    }
    // send response
    response.status(200).json(json)
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
        setupTopic,
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

    switchMode,
    init,

}