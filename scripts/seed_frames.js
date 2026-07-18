import { prisma } from "../configs/prisma.js";

const frames = [
  {
    id: 'frame-gold-001',
    item_name: 'Golden Champion',
    item_type: 'FRAME',
    price: 500,
    image_url: 'https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg', // Placeholder
    is_active: true,
  },
  {
    id: 'frame-diamond-002',
    item_name: 'Diamond Elite',
    item_type: 'FRAME',
    price: 1500,
    image_url: 'https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg', // Placeholder
    is_active: true,
  },
  {
    id: 'frame-fire-003',
    item_name: 'Inferno Ring',
    item_type: 'FRAME',
    price: 300,
    image_url: 'https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg', // Placeholder
    is_active: true,
  }
];

async function main() {
  console.log('Seeding profile frames...');

  for (const frame of frames) {
    const existingFrame = await prisma.shopItem.findUnique({ where: { id: frame.id } });
    
    if (!existingFrame) {
      await prisma.shopItem.create({
        data: frame,
      });
      console.log(`Created frame: ${frame.item_name}`);
    } else {
      console.log(`Frame already exists: ${frame.item_name}`);
    }
  }

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
