const { Markup } = require('telegraf')
const { categories } = require('./menu')

const tableKeyboard = Markup.keyboard([
    ['Table 1', 'Table 2', 'Table 3'],
    ['Table 4', 'Table 5', 'Table 6']
]).resize().oneTime()

function buildMainMenu() {
    const categoryButtons = categories.map(cat => cat.name)
    const catRows = []
    for (let i = 0; i < categoryButtons.length; i += 2) {
        catRows.push(categoryButtons.slice(i, i + 2))
    }
    return Markup.keyboard([
        ...catRows,
        ['🛒 View Cart', '✅ Checkout'],
        ['🗑 Clear Cart', '🧾 Request Bill'],
        ['🆘 Call Waiter']
    ]).resize()
}

function buildCategoryMenu(categoryName) {
    const cat = categories.find(c => c.name === categoryName)
    if (!cat) return buildMainMenu()
    const itemButtons = cat.items.map(item => `${item.name} — ${item.price} ETB`)
    const rows = []
    for (let i = 0; i < itemButtons.length; i += 2) {
        rows.push(itemButtons.slice(i, i + 2))
    }
    return Markup.keyboard([...rows, ['⬅️ Back to Menu']]).resize()
}

module.exports = { tableKeyboard, buildMainMenu, buildCategoryMenu }
