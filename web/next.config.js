/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // basePath: '/vocation-hub-plus',  // Only needed for GitHub Pages subdirectory
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
