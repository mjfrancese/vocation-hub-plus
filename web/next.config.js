/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/vocation-hub-plus',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
