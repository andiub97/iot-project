const { InfluxDB } = require('@influxdata/influxdb-client')
const { Telegraf } = require('telegraf')
const { createServer } = require("http");
require('dotenv').config({ path: '../.env' })


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

client = new InfluxDB({ url: 'http://' + InfluxData.host + ":" + InfluxData.port, token: InfluxData.token })

const bot = new Telegraf(process.env.BOT_KEY);

bot.start((context) => {

    console.log("sensor_stat_bot is started")
    context.reply("Hello! I am an Alert Bot, in my private chat you can ask me the mean value of a bucket filtered by host. Hosts are ESP32 with DHT22 and MQ2 sensors for temperature, humidity and gas concentration." +
        "I can provide you some additional metadata like WiFi RSS and AQI in mean view. If you want to know what can I do, click on help! " +
        "")
})

bot.command('help', async (ctx) => {

    ctx.reply('👋 I can help you create and manage a notification system on your personal device.\n\n' +

        'COMMANDS:\nEach command is preceded by a back slash\n\n' +
        'help - it is the current message.\n\n' +
        'buckets - list the current monitored influx buckets.\n\n' +
        '<bucket-id> - it has one parameter equals to the id of the host to monitor, the <bucket-id> is given by \\buckets command.\n\n\n' +

        'I was made for the Internet of Things project of @Andiub and @RiccardoBaratin, the link to the github project :')

    ctx.reply("github.com/andiub97/iot-project")

})

bot.command('buckets', (ctx) => {
    ctx.reply("Actually, buckets are:\n\n" +
        "temp - it provides the mean indoor temperature in celsius\n\n " +
        "out_temp - it provides the mean outdoor temperature in celsius\n\n " +
        "hum  - it display the mean humidity concentration\n\n " +
        "gas - it provides the mean gas concentration (inverse value from 4096 [low] to 0 [high])\n\n " +
        "rss -  it is the WiFi RSS of selected host\n\n " +
        "aqi - it is the mean AQI on the past 5 iteration\n " +
        "\n\nIf you want to invoke them, you must put a back slash before and specify the id of the host. The @Andiub's host is diubi-esp-32")
})


for (const [key, value] of Object.entries(InfluxData.buckets)) {
    console.log('Creation of command /' + key + ' to query on bucket ' + value)
    bot.command(key, context => {
        let textBot = context.update.message
        let host = textBot.text.split(' ')[1]
        if (host == null || host == undefined || host == " ") {
            context.reply('Need to specify a sensor host id!')
        } else {
            let bucket = value
            let query = `
           from(bucket: "${bucket}") 
           |> range(start: -10m)
           |> filter(fn: (r) => r["_measurement"] == "val")
           |> filter(fn: (r) => r["_field"] == "${bucket}")
           |> filter(fn: (r) => r["clientId"] == "${host}")
           |> filter(fn : (r) => r["prediction"] == "no")
           |> movingAverage(n: 5)
           |> yield(name: "mean")
           `
            console.log(query)
            const queryApi = client.getQueryApi(InfluxData.org)
            var rowResult;
            queryApi.queryRows(query, {
                next(row, tableMeta) {
                    rowResult = tableMeta.toObject(row)._value
                },
                error(e) {
                    context.reply("Sensor is offline, try later!")
                },
                complete() {
                    if (rowResult == undefined || rowResult == null) {
                        context.reply("Sensor is offline, try later!")
                    } else {
                        console.log('Writing bot for /' + value + " command");
                        switch (value) {
                            case "temperature": context.reply("The current indoor mean " + bucket + " is " + Math.round(rowResult, 2) + "° on sensor " + host); break;
                            case "out_temperature": context.reply("The current outdoor mean temperature, provided by OpenWeather, is " + Math.round(rowResult, 2) + "° provided by OpenWeather"); break;
                            case "humidity": context.reply("The current mean " + bucket + " is " + Math.round(rowResult, 2) + "% on sensor " + host); break;
                            case "rss": context.reply("The current mean " + bucket + " is " + Math.round(rowResult, 2) + " dBm on sensor " + host); break;
                            case "aqi": context.reply("The current mean " + bucket + " is " + Math.round(rowResult, 2) + " on sensor " + host); break;
                            case "gas": context.reply("The current mean " + bucket + " is " + Math.round(rowResult, 2) + " ppm on sensor " + host); break;
                            default: break;
                        }

                    }
                },
            })
        }
    })

}
console.log('Status: Success')
console.log('Launching bot...')
bot.launch();
console.log('Bot listening...')



