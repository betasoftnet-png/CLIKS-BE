/**
 * CLIKS Business ERP — HSN/SAC Taxonomy & Domain Search Intent Engine
 * 
 * Maps user search queries, brand names, product terms, and multilingual terms
 * to target HSN/SAC code families, description keywords, and classification types.
 */

// ── Normalize User Search Query ────────────────────────────────────────────────
function normalizeQuery(rawQuery) {
    if (!rawQuery) return '';
    let q = String(rawQuery).toLowerCase().trim();
    // Replace punctuation and hyphens with single spaces safely
    q = q.replace(/[-_.,/\\()$&@#*+!?:;]/g, ' ');
    // Collapse multiple consecutive spaces
    q = q.replace(/\s+/g, ' ').trim();
    return q;
}

// ── Domain Taxonomy Definitions ───────────────────────────────────────────────
const DOMAIN_TAXONOMY = [
    // 1. Mobile Phones & Wireless Accessories
    {
        domain: 'mobile_phone',
        synonyms: [
            'iphone', 'apple iphone', 'apple', 'samsung', 'samsung mobile', 'samsung galaxy',
            'oneplus', 'oneplus phone', 'oneplus mobile', 'vivo', 'vivo mobile', 'oppo', 'oppo mobile',
            'redmi', 'redmi phone', 'realme', 'realme phone', 'xiaomi', 'pixel', 'nokia', 'motorola',
            'cellphone', 'cell phone', 'mobile', 'smartphone', 'mobile phone', 'telephone', 'phone',
            'cellular', 'handset'
        ],
        hsnPrefixes: ['8517', '851711', '851712', '851718'],
        keywords: ['cellular', 'telephone', 'wireless network', 'phone', 'push button'],
        type: 'goods'
    },
    {
        domain: 'mobile_accessories',
        synonyms: ['charger', 'mobile charger', 'power bank', 'data cable', 'usb cable', 'screen guard', 'mobile cover'],
        hsnPrefixes: ['8504', '8544', '3926', '850440'],
        keywords: ['chargers', 'static converters', 'insulated wire', 'cables', 'plastics']
    },

    // 2. Laptops, Computers & Tech
    {
        domain: 'computer_laptop',
        synonyms: [
            'macbook', 'macbook pro', 'macbook air', 'laptop', 'notebook', 'dell', 'dell laptop', 'dell inspiron',
            'hp', 'hp laptop', 'hp pavilion', 'lenovo', 'lenovo laptop', 'lenovo thinkpad', 'acer', 'acer laptop',
            'asus', 'asus laptop', 'computer', 'pc', 'desktop', 'desktop computer', 'personal computer',
            'ipad', 'tablet', 'chromebook'
        ],
        hsnPrefixes: ['8471', '847130', '84713010', '847141', '847150'],
        keywords: ['automatic data processing', 'data processing machine', 'personal computer'],
        type: 'goods'
    },
    {
        domain: 'computer_peripherals',
        synonyms: ['monitor', 'display', 'keyboard', 'mouse', 'printer', 'scanner', 'hard disk', 'ssd', 'ram', 'memory card', 'pendrive', 'usb drive'],
        hsnPrefixes: ['847160', '847170', '8473', '8523'],
        keywords: ['input or output units', 'storage units', 'printing', 'media']
    },

    // 3. Groceries & Supermarket Staples
    {
        domain: 'rice',
        synonyms: ['rice', 'chawal', 'arisi', 'paddy', 'basmati', 'biryani rice', 'raw rice', 'boiled rice'],
        hsnPrefixes: ['1006', '100610', '100620', '100630', '1102'],
        keywords: ['rice', 'husked', 'paddy', 'basmati'],
        type: 'goods'
    },
    {
        domain: 'wheat',
        synonyms: ['wheat', 'gehun', 'godhumai', 'atta', 'wheat flour', 'maida', 'sooji', 'rawa'],
        hsnPrefixes: ['1001', '100111', '100119', '1101', '110100'],
        keywords: ['wheat', 'meslin', 'flour'],
        type: 'goods'
    },
    {
        domain: 'barley',
        synonyms: ['barley', 'jau'],
        hsnPrefixes: ['1003', '100310', '100390'],
        keywords: ['barley'],
        type: 'goods'
    },
    {
        domain: 'sugar',
        synonyms: ['sugar', 'cheeni', 'sakkarai', 'jaggery', 'gud', 'sugar cane'],
        hsnPrefixes: ['1701', '170112', '170113', '170199', '1702'],
        keywords: ['sugar', 'cane', 'sucrose'],
        type: 'goods'
    },
    {
        domain: 'salt',
        synonyms: ['salt', 'namak', 'uppu', 'table salt', 'rock salt'],
        hsnPrefixes: ['2501', '250100'],
        keywords: ['salt', 'sodium chloride'],
        type: 'goods'
    },
    {
        domain: 'tea_coffee',
        synonyms: ['tea', 'chai', 'theelai', 'green tea', 'tea powder', 'coffee', 'kaapi', 'coffee powder', 'instant coffee'],
        hsnPrefixes: ['0902', '0901', '2101'],
        keywords: ['tea', 'coffee', 'extracts'],
        type: 'goods'
    },
    {
        domain: 'cooking_oil',
        synonyms: ['cooking oil', 'mustard oil', 'sunflower oil', 'groundnut oil', 'coconut oil', 'palm oil', 'ghee', 'oil', 'edible oil'],
        hsnPrefixes: ['1507', '1508', '1509', '1512', '1513', '1514', '1515', '0405'],
        keywords: ['oil', 'fat', 'butter', 'ghee'],
        type: 'goods'
    },
    {
        domain: 'pulses_dal',
        synonyms: ['dal', 'pulses', 'toor dal', 'moong dal', 'chana dal', 'urad dal', 'lentils', 'gram'],
        hsnPrefixes: ['0713', '071310', '071320', '071340', '071390'],
        keywords: ['dried leguminous', 'pulses', 'lentils', 'peas'],
        type: 'goods'
    },
    {
        domain: 'spices',
        synonyms: ['spices', 'masala', 'turmeric', 'haldi', 'chilli powder', 'cumin', 'jeera', 'pepper', 'cardamom', 'cloves'],
        hsnPrefixes: ['0904', '0906', '0908', '0909', '0910'],
        keywords: ['spices', 'pepper', 'cinnamon', 'cloves', 'ginger', 'turmeric'],
        type: 'goods'
    },
    {
        domain: 'dairy',
        synonyms: ['milk', 'curd', 'dahi', 'paneer', 'butter', 'cheese', 'dairy', 'cream'],
        hsnPrefixes: ['0401', '0402', '0403', '0405', '0406'],
        keywords: ['milk', 'cream', 'yogurt', 'curd', 'butter', 'cheese'],
        type: 'goods'
    },
    {
        domain: 'packaged_snacks',
        synonyms: ['biscuits', 'cookies', 'biscuit', 'packaged food', 'snacks', 'namkeen', 'chips', 'bread', 'cake', 'ice cream'],
        hsnPrefixes: ['1905', '190531', '1904', '2105', '2106'],
        keywords: ['sweet biscuits', 'waffles', 'wafers', 'bakers', 'ice cream', 'food preparations'],
        type: 'goods'
    },

    // 4. Vegetable & Fresh Produce Shop
    {
        domain: 'vegetables',
        synonyms: [
            'tomato', 'tamatar', 'thakkali', 'potato', 'aalu', 'urulaikizhangu', 'onion', 'pyaaz', 'vengayam',
            'carrot', 'cabbage', 'cauliflower', 'brinjal', 'eggplant', 'lady finger', 'bhindi', 'okra',
            'green chilli', 'chilli', 'spinach', 'palak', 'beans', 'peas', 'muttar', 'drumstick', 'pumpkin',
            'vegetables', 'veggies', 'sabzi'
        ],
        hsnPrefixes: ['0701', '0702', '0703', '0704', '0705', '0706', '0708', '0709', '0710'],
        keywords: ['vegetable', 'tomatoes', 'potatoes', 'onions', 'cabbages', 'carrots', 'leguminous', 'capsicum'],
        type: 'goods'
    },

    // 5. Electrical Goods
    {
        domain: 'electrical_lighting',
        synonyms: ['led bulb', 'led light', 'tube light', 'light bulb', 'lamp', 'bulb', 'lighting'],
        hsnPrefixes: ['8539', '853950', '9405'],
        keywords: ['electric filament', 'discharge lamps', 'light-emitting diode', 'lamps'],
        type: 'goods'
    },
    {
        domain: 'electrical_switches_cables',
        synonyms: [
            'switch', 'socket', 'plug', 'mcb', 'circuit breaker', 'electrical panel', 'fuse',
            'electrical wire', 'electrical cable', 'wire', 'cable', 'copper wire', 'electrical equipment'
        ],
        hsnPrefixes: ['8536', '8537', '8535', '8544', '7408'],
        keywords: ['switching', 'protecting electrical circuits', 'boards', 'panels', 'switches', 'insulated wire', 'cables'],
        type: 'goods'
    },
    {
        domain: 'electrical_fans',
        synonyms: ['fan', 'ceiling fan', 'table fan', 'exhaust fan'],
        hsnPrefixes: ['8414', '841451'],
        keywords: ['fans', 'table', 'floor', 'wall', 'window', 'ceiling'],
        type: 'goods'
    },

    // 6. Consumer Electronics & Appliances
    {
        domain: 'appliances_tv',
        synonyms: [
            'television', 'tv', 'led tv', 'smart tv', 'refrigerator', 'fridge', 'washing machine', 'washer',
            'microwave oven', 'oven', 'air conditioner', 'ac', 'speaker', 'headphones', 'earphones', 'soundbar',
            'camera', 'dslr', 'electronic equipment'
        ],
        hsnPrefixes: ['8528', '852872', '8418', '8450', '8516', '8415', '8518', '8525'],
        keywords: ['reception apparatus for television', 'monitors', 'refrigerators', 'washing machines', 'microwave ovens', 'air conditioning', 'loudspeakers'],
        type: 'goods'
    },

    // 7. Clothing & Apparel
    {
        domain: 'clothing_apparel',
        synonyms: [
            't-shirt', 'tshirt', 'shirt', 'jeans', 'trousers', 'pant', 'saree', 'dress', 'jacket',
            'cotton shirt', "children's clothing", 'clothing', 'apparel', 'garment', 'clothes'
        ],
        hsnPrefixes: ['6105', '6109', '6203', '6204', '6205', '6206', '6104', '6103'],
        keywords: ['garment', 'apparel', 'shirt', 'trouser', 'suit', 'dress', 'saree'],
        type: 'goods'
    },

    // 8. Footwear
    {
        domain: 'footwear',
        synonyms: ['shoes', 'shoe', 'sports shoes', 'sandals', 'slippers', 'leather shoes', 'chappal', 'footwear', 'boots', 'sneakers'],
        hsnPrefixes: ['6401', '6402', '6403', '6404', '6405'],
        keywords: ['footwear', 'shoes', 'sandals', 'slippers', 'soles'],
        type: 'goods'
    },

    // 9. Hardware & Building Materials
    {
        domain: 'hardware_building',
        synonyms: [
            'nails', 'nail', 'screw', 'screws', 'bolt', 'bolts', 'nut', 'nuts', 'steel rod', 'pipe',
            'pvc pipe', 'tools', 'drill machine', 'drill', 'hammer', 'hardware'
        ],
        hsnPrefixes: ['7318', '7304', '7306', '3917', '8205', '8467'],
        keywords: ['screws', 'bolts', 'nuts', 'nails', 'tubes', 'pipes', 'hand tools'],
        type: 'goods'
    },

    // 10. Furniture
    {
        domain: 'furniture',
        synonyms: ['table', 'chair', 'office chair', 'sofa', 'bed', 'cupboard', 'wooden furniture', 'furniture', 'desk'],
        hsnPrefixes: ['9401', '9403'],
        keywords: ['seats', 'other furniture', 'wooden furniture', 'metal furniture'],
        type: 'goods'
    },

    // 11. Stationery & Office Supplies
    {
        domain: 'stationery',
        synonyms: ['notebook', 'register', 'book', 'pen', 'pencil', 'eraser', 'marker', 'paper', 'printer paper', 'files', 'folder', 'envelope', 'stationery'],
        hsnPrefixes: ['4820', '9608', '9609', '4802'],
        keywords: ['registers', 'account books', 'notebooks', 'pens', 'pencils', 'paper'],
        type: 'goods'
    },

    // 12. Automobile & Spare Parts
    {
        domain: 'automobile_parts',
        synonyms: [
            'engine oil', 'oil filter', 'air filter', 'lubricant', 'brake pad', 'clutch plate',
            'tyre', 'tire', 'battery', 'headlight', 'auto parts', 'spare parts', 'automobile parts'
        ],
        hsnPrefixes: ['2710', '8708', '4011', '8507', '8421', '8512'],
        keywords: ['parts and accessories of motor vehicles', 'pneumatic tyres', 'electric accumulators', 'filters', 'lubricating'],
        type: 'goods'
    },

    // 13. Pharmacy & Medical Supplies
    {
        domain: 'pharmacy_medical',
        synonyms: ['medicine', 'pharma', 'tablet', 'capsule', 'syrup', 'antibiotic', 'drug', 'pharmaceutical', 'mask', 'bandage', 'syringe', 'medical equipment'],
        hsnPrefixes: ['3003', '3004', '3005', '9018'],
        keywords: ['medicaments', 'wadding', 'gauze', 'medical', 'surgical'],
        type: 'goods'
    },

    // 14. Meat, Poultry & Fish (Hotels / Kitchens)
    {
        domain: 'meat_poultry_fish',
        synonyms: ['chicken', 'mutton', 'meat', 'fish', 'prawns', 'egg', 'eggs'],
        hsnPrefixes: ['0207', '0204', '0302', '0303', '0407'],
        keywords: ['meat', 'poultry', 'fish', 'birds eggs'],
        type: 'goods'
    },

    // 15. Hotel, Restaurant & Catering Services (SAC)
    {
        domain: 'restaurant_hotel_services',
        synonyms: [
            'restaurant service', 'food service', 'catering service', 'hotel accommodation',
            'room service', 'banquet service', 'hotel', 'restaurant', 'catering', 'accommodation service'
        ],
        hsnPrefixes: ['9963', '996331', '996311', '996332', '996333'],
        keywords: ['services', 'restaurant', 'catering', 'accommodation', 'hotel'],
        type: 'services'
    }
];

// ── Resolve Search Intent & Intent Matcher ────────────────────────────────────
function resolveSearchIntent(rawQuery) {
    const normalized = normalizeQuery(rawQuery);
    if (!normalized) {
        return {
            normalized,
            isNumeric: false,
            mappedPrefixes: [],
            mappedKeywords: [],
            classificationType: 'all'
        };
    }

    const isNumeric = /^\d+$/.test(normalized);
    const mappedPrefixes = [];
    const mappedKeywords = [];
    let classificationType = 'all';

    if (!isNumeric) {
        const words = normalized.split(' ');
        for (const item of DOMAIN_TAXONOMY) {
            const isMatch = item.synonyms.some(syn => {
                const normSyn = normalizeQuery(syn);
                if (normalized === normSyn || normalized.includes(normSyn)) {
                    return true;
                }
                // Word-level matching for multi-word queries or exact word matches
                return words.some(w => w.length >= 3 && (normSyn === w || normSyn.includes(w)));
            });

            if (isMatch) {
                if (item.type) {
                    classificationType = item.type;
                }
                for (const p of item.hsnPrefixes) {
                    if (!mappedPrefixes.includes(p)) mappedPrefixes.push(p);
                }
                for (const k of item.keywords) {
                    if (!mappedKeywords.includes(k)) mappedKeywords.push(k);
                }
            }
        }
    }

    return {
        normalized,
        isNumeric,
        mappedPrefixes,
        mappedKeywords,
        classificationType
    };
}

module.exports = {
    normalizeQuery,
    resolveSearchIntent,
    DOMAIN_TAXONOMY
};
