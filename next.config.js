/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ['playwright', 'winston'] }
}
module.exports = nextConfig
