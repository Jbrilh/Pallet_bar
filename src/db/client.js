const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
    process.env.SUPABASE_URL    || 'https://gzwxcdjvezevyvicamgc.supabase.co',
    process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6d3hjZGp2ZXpldnl2aWNhbWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzOTgxMzYsImV4cCI6MjA5Mzk3NDEzNn0.-jQhDC2o6Pbb-Nk8Byhs2lMzGks637KwH-6NXsb2Ujg'
)

module.exports = { supabase }
