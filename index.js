require('dotenv').config()

const { bot } = require('./src/bot')

require('./src/handlers/registration')
require('./src/handlers/customer')
require('./src/handlers/staff')
require('./src/handlers/owner')

bot.launch()
console.log('🍻 Bar POS Bot Running...')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
