require('dotenv').config({ path: '../.env' })

const { Telegraf } = require('telegraf')
const express = require('express')
const expressApp = express()

const bot = new Telegraf(process.env.ALERT_BOT_KEY)
expressApp.use(bot.webhookCallback('/newTelegramUser'))
bot.telegram.setWebhook('https://4b87-93-34-80-34.eu.ngrok.io/newTelegramUser')

expressApp.get('/', (req, res) => {
    res.send('Hello World!')
})

expressApp.listen(3010, () => {
    console.log('Example app listening on port 3000!')
})





