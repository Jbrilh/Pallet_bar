require('dotenv').config()

require('./src/handlers/registration')
require('./src/handlers/customer')
require('./src/handlers/staff')
require('./src/handlers/owner')

const { startServer } = require('./src/server')
startServer()

process.once('SIGINT',  () => process.exit(0))
process.once('SIGTERM', () => process.exit(0))
