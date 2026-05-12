function getTableGroup(tableName, config) {
    return config.tableGroupMap[tableName] ?? null
}

function splitCartByGroup(cart, config) {
    const byGroup = new Map()
    for (const item of cart) {
        const entry = config.itemMap[item.name]
        const category = entry?.category_id ? config.categoryMap[entry.category_id] : null
        const groupId = category?.routes_to_group_id ?? null
        if (!byGroup.has(groupId)) byGroup.set(groupId, [])
        byGroup.get(groupId).push(item)
    }
    return byGroup
}

function getGroupByType(type, config) {
    return config.groups.find(g => g.type === type) ?? null
}

module.exports = { getTableGroup, splitCartByGroup, getGroupByType }
