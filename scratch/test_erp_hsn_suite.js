const hsnController = require('../controllers/hsnController');

async function executeSearch(q) {
  const req = { query: { q } };
  let results = [];
  const res = {
    status: function() { return this; },
    json: function(payload) {
      results = payload.data || [];
      return this;
    }
  };
  await hsnController.searchHSN(req, res);
  return results;
}

async function runComprehensiveERPTests() {
  const testCategories = [
    {
      category: 'VEGETABLES',
      queries: ['Tomato', 'Potato', 'Onion']
    },
    {
      category: 'GROCERY & COMMODITIES',
      queries: ['Rice', 'Wheat', 'Barley', 'Sugar', 'Chawal', 'Gehun', 'Arisi', 'Godhumai', 'Jau']
    },
    {
      category: 'MOBILE PHONES & BRAND SEARCH',
      queries: ['iPhone', 'Apple iPhone 15', 'Samsung mobile', 'OnePlus phone', 'Vivo mobile', 'Redmi phone']
    },
    {
      category: 'LAPTOPS & TECH',
      queries: ['MacBook', 'MacBook Pro', 'Dell laptop', 'HP laptop', 'Lenovo laptop', 'Laptop']
    },
    {
      category: 'ELECTRICAL GOODS',
      queries: ['LED bulb', 'Electrical wire', 'Ceiling fan', 'Switch']
    },
    {
      category: 'ELECTRONICS & APPLIANCES',
      queries: ['Television', 'Refrigerator', 'Speaker', 'Headphones']
    },
    {
      category: 'CLOTHING & APPAREL',
      queries: ['T-shirt', 'Jeans', 'Shirt', 'Saree']
    },
    {
      category: 'FOOTWEAR',
      queries: ['Shoes', 'Sandals', 'Slippers']
    },
    {
      category: 'HARDWARE & BUILDING',
      queries: ['Nails', 'Screw', 'Bolt', 'Steel rod', 'PVC pipe']
    },
    {
      category: 'FURNITURE',
      queries: ['Table', 'Chair', 'Sofa', 'Bed']
    },
    {
      category: 'STATIONERY',
      queries: ['Notebook', 'Pen', 'Pencil', 'Paper']
    },
    {
      category: 'AUTOMOBILE & SPARE PARTS',
      queries: ['Brake pad', 'Tyre', 'Battery', 'Engine oil']
    },
    {
      category: 'HOTEL, RESTAURANT & SERVICES (SAC)',
      queries: ['Restaurant service', 'Catering service', 'Hotel accommodation', 'Chicken', 'Cooking oil', 'Milk', 'Tea', 'Coffee', 'Bread', 'Cake']
    },
    {
      category: 'DIRECT HSN/SAC CODE SEARCH',
      queries: ['1001', '1003', '1006', '8517', '851712', '8471']
    },
    {
      category: 'CASE & WHITESPACE VARIATIONS',
      queries: ['iphone', 'IPHONE', 'iPhone', '  iPhone  ', 'rice', 'RICE', '  rice  ', 'restaurant service', 'RESTAURANT SERVICE']
    },
    {
      category: 'PARTIAL SEARCH',
      queries: ['lap', 'mobil', 'tele', 'bar']
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const cat of testCategories) {
    console.log(`\n========================================`);
    console.log(`SECTION: ${cat.category}`);
    console.log(`========================================`);
    for (const q of cat.queries) {
      const results = await executeSearch(q);
      if (results.length > 0) {
        passed++;
        console.log(`✅ [PASS] "${q}" -> Returned ${results.length} results. Top: [${results[0].hsnCode}] ${results[0].description.slice(0, 60)}...`);
      } else {
        failed++;
        console.error(`❌ [FAIL] "${q}" -> Returned 0 results!`);
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`ERP SUITE TEST SUMMARY: ${passed} PASSED, ${failed} FAILED.`);
  console.log(`========================================`);
  if (failed > 0) {
    process.exit(1);
  }
}

runComprehensiveERPTests().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
