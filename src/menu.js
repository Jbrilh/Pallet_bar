const fs = require('fs')
const path = require('path')

const { categories } = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'menu.json'), 'utf8')
)

const ITEM_MAP = {}
for (const cat of categories) {
    for (const item of cat.items) {
        ITEM_MAP[item.name] = { ...item, category: cat.name }
    }
}

module.exports = { categories, ITEM_MAP }
