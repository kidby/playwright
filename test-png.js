const fs = require('fs');
const { PNG } = require('pngjs');
const { decode, encode } = require('fast-png');

// Create a dummy image
const width = 800;
const height = 600;
const data = Buffer.alloc(width * height * 4);
for (let i = 0; i < data.length; i++) {
  data[i] = Math.floor(Math.random() * 255);
}

// Write to buffer using pngjs
const png = new PNG({ width, height });
png.data = data;
const buffer = PNG.sync.write(png);

// Test decoding
console.time('pngjs decode');
for(let i=0; i<10; i++) PNG.sync.read(buffer);
console.timeEnd('pngjs decode');

console.time('fast-png decode');
for(let i=0; i<10; i++) decode(buffer);
console.timeEnd('fast-png decode');

// Test encoding
console.time('pngjs encode');
for(let i=0; i<10; i++) PNG.sync.write(png);
console.timeEnd('pngjs encode');

const fastPngData = { width, height, data: new Uint8Array(data) };
console.time('fast-png encode');
for(let i=0; i<10; i++) encode(fastPngData);
console.timeEnd('fast-png encode');
