const { WAITRESS_1_GROUP_ID, WAITRESS_2_GROUP_ID, WAITRESS_CATEGORIES } = require('../config')
const { ITEM_MAP } = require('../menu')

function getWaitressGroup(table) {
    const num = parseInt(table.replace('Table ', ''))
    return num <= 3 ? WAITRESS_1_GROUP_ID : WAITRESS_2_GROUP_ID
}

function splitCart(cart) {
    const waitressItems = []
    const bartenderItems = []
    for (const item of cart) {
        const menuEntry = ITEM_MAP[item.name]
        if (menuEntry && WAITRESS_CATEGORIES.includes(menuEntry.category)) {
            waitressItems.push(item)
        } else {
            bartenderItems.push(item)
        }
    }
    return { waitressItems, bartenderItems }
}

module.exports = { getWaitressGroup, splitCart }
