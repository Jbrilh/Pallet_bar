const { Markup } = require('telegraf')

function buildTableKeyboard(config) {
    const names = config.tables.map(t => t.table_name)
    const rows = []
    for (let i = 0; i < names.length; i += 3) rows.push(names.slice(i, i + 3))
    return Markup.keyboard(rows.length ? rows : [['No tables configured']]).resize().oneTime()
}

function buildMainMenu(config) {
    const catNames = config.categories
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(c => c.name)
    const catRows = []
    for (let i = 0; i < catNames.length; i += 2) catRows.push(catNames.slice(i, i + 2))
    return Markup.keyboard([
        ...catRows,
        ['🛒 View Cart', '✅ Checkout'],
        ['🗑 Clear Cart', '🧾 Request Bill'],
        ['🆘 Call Waiter']
    ]).resize()
}

function buildCategoryMenu(categoryId, config) {
    const items = config.items
        .filter(i => i.category_id === categoryId)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const buttons = items.map(i => `${i.name} — ${i.price} ETB`)
    const rows = []
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2))
    return Markup.keyboard([...rows, ['⬅️ Back to Menu']]).resize()
}

module.exports = { buildTableKeyboard, buildMainMenu, buildCategoryMenu }
