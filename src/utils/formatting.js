function formatItems(items) {
    return items.map(i => `  - ${i.name} x ${i.qty}`).join('\n')
}

module.exports = { formatItems }
