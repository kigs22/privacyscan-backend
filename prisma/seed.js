// prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const packages = [
    {
      slug:          'single',
      name:          'Single Scan',
      priceKES:      250,
      scans:         1,
      validityHours: 24,
    },
    {
      slug:          'weekend',
      name:          'Weekend Pass',
      priceKES:      999,
      scans:         5,
      validityHours: 72,
    },
    {
      slug:          'explorer',
      name:          'Explorer Pack',
      priceKES:      2500,
      scans:         15,
      validityHours: 8760, // 1 year
    },
    {
      slug:          'corporate',
      name:          'Corporate Pack',
      priceKES:      7500,
      scans:         -1,   // unlimited
      validityHours: 720,  // 1 month
    },
  ];

  for (const pkg of packages) {
    await prisma.package.upsert({
      where:  { slug: pkg.slug },
      update: pkg,
      create: pkg,
    });
    console.log(`✓ Package seeded: ${pkg.name}`);
  }

  console.log('\nSeed complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
