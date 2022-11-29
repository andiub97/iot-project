const { InfluxDB } = require('@influxdata/influxdb-client')
const { Point } = require('@influxdata/influxdb-client')
require('dotenv').config({ path: '../.env' })

class InfluxManager {
    constructor(host, port, token, org) {
        this.client = new InfluxDB({ url: 'http://' + host + ":" + port, token: token })
        this.host = host
        this.port = port
        this.token = token
        this.org = org
    }

    writeApi(clientId, gps, bucket, value) {
        const writeApi = this.client.getWriteApi(this.org, bucket)
        writeApi.useDefaultTags({ prediction: "no", clientId, lat: gps.lat.toString(), lng: gps.lng.toString() })
        var point = new Point('val')
        if (bucket == undefined || value == null) {
            return false;
        }
        if (bucket == "aqi" || bucket == "gas") {
            point = point.intField(bucket, value)
        } else {
            point = point.floatField(bucket, value)
            // value = Math.round(value, 2)
        }
        writeApi.writePoint(point)
        

        writeApi.close()
            .then(() => {
                console.log('InfluxDB: Wrote value: ' + value + " on bucket: " + bucket + " with host: " + clientId + "; lat: " + gps.lat + "; lng: " + gps.lng)
            })
            .catch(e => {
                console.log('InfluxDB Error: ' + e)
            })
        return true
    }

    queryApi(query) {
        const queryApi = this.client.getQueryApi(this.org)
        queryApi.queryRows(query, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row)
                console.log(`${o._time} ${o._measurement}: ${o._field}=${o._value}`)
            },
            error(e) {
                console.log('InfluxDB Error: ' + e)
            },
            complete() {
                console.log('InfluxDB: Complete query')
            },
        })
    }
}

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


module.exports = {
    InfluxManager,
    InfluxData,
}





