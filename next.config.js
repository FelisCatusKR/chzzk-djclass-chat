/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    DATABASE_URL: process.env.DATABASE_URL || './data/app.db',
  },
}

module.exports = nextConfig
