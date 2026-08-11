/**
 * CLIKS Business ERP — Precision HSN/SAC Taxonomy & Domain Search Intent Engine
 * 
 * Maps user search queries, brand names, product terms, and multilingual terms
 * to exact target HSN/SAC code families, description keywords, and classification types.
 */

const MODIFIER_WORDS = new Set([
    'pro', 'max', 'plus', 'mini', 'lite', 'ultra', 'series', 'model',
    'v1', 'v2', 'v3', 'v4', 'v5', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
    '11', '12', '13', '14', '15', '16', '5g', '4g', '3g', '2g',
    'm1', 'm2', 'm3', 'm4', 'm5', 'gen', 'generation', 'edition', 'super', 'prime',
    'duo', 'air', 'fold', 'flip', 'touch', 'smart', 'star',
    'for', 'and', 'the', 'with', 'in', 'of', 'a', 'an', 'by', 'to', 'on'
]);

function normalizeQuery(rawQuery) {
    if (!rawQuery) return '';
    let q = String(rawQuery).toLowerCase().trim();
    q = q.replace(/[-_.,/\\()$&@#*+!?:;]/g, ' ');
    q = q.replace(/\s+/g, ' ').trim();
    return q;
}

function cleanSearchTerms(normalizedQuery) {
    if (!normalizedQuery) return [];
    const words = normalizedQuery.split(' ').filter(Boolean);
    return words.filter(w => !MODIFIER_WORDS.has(w) && w.length >= 2);
}

const DOMAIN_TAXONOMY = [
    // 1. Mobile Phones & Wireless Handsets
    {
        domain: 'mobile_phone',
        synonyms: [
            'iphone', 'apple iphone', 'samsung mobile', 'samsung galaxy', 'samsung', 'oneplus phone', 'oneplus mobile',
            'vivo mobile', 'oppo mobile', 'redmi phone', 'redmi', 'realme phone', 'realme', 'xiaomi',
            'pixel', 'nokia', 'motorola', 'cellphone', 'cell phone', 'mobile phone', 'mobile',
            'smartphone', 'telephone', 'phone', 'cellular', 'handset'
        ],
        hsnPrefixes: ['8517', '851711', '851712', '851718'],
        keywords: ['cellular', 'telephone', 'wireless network', 'phone'],
        type: 'goods'
    },
    // 2. Mobile Accessories & Chargers
    {
        domain: 'mobile_accessories',
        synonyms: ['mobile charger', 'charger', 'power bank', 'data cable', 'usb cable', 'screen guard'],
        hsnPrefixes: ['8504', '850440', '8544'],
        keywords: ['chargers', 'static converters', 'insulated wire', 'cables']
    },

    // 3. Laptops, Computers & Notebooks
    {
        domain: 'computer_laptop',
        synonyms: [
            'macbook', 'macbook pro', 'macbook air', 'macbook pro 5', 'macbook pro m1', 'macbook pro m2', 'macbook pro m3',
            'laptop', 'notebook', 'dell laptop', 'dell inspiron', 'hp laptop', 'hp pavilion', 'lenovo laptop',
            'lenovo thinkpad', 'acer laptop', 'asus laptop', 'computer', 'pc', 'desktop computer', 'personal computer',
            'ipad', 'tablet', 'chromebook'
        ],
        hsnPrefixes: ['8471', '847130', '84713010', '847141', '847150'],
        keywords: ['automatic data processing', 'data processing machine', 'personal computer'],
        type: 'goods'
    },
    {
        domain: 'computer_peripherals',
        synonyms: ['monitor', 'computer display', 'keyboard', 'mouse', 'printer', 'scanner', 'hard disk', 'ssd', 'ram', 'memory card', 'pendrive', 'usb drive'],
        hsnPrefixes: ['847160', '847170', '8473', '8523'],
        keywords: ['input or output units', 'storage units', 'printing', 'media']
    },

    // 4. Groceries: Rice
    {
        domain: 'rice',
        synonyms: ['rice', 'basmati rice', 'basmati', 'chawal', 'arisi', 'paddy', 'biryani rice', 'raw rice', 'boiled rice'],
        hsnPrefixes: ['1006', '100610', '100620', '100630', '1102'],
        keywords: ['rice', 'husked', 'paddy', 'basmati'],
        type: 'goods'
    },
    // 5. Groceries: Wheat & Flour
    {
        domain: 'wheat',
        synonyms: ['wheat', 'atta', 'gehun', 'godhumai', 'wheat flour', 'maida', 'sooji', 'rawa'],
        hsnPrefixes: ['1001', '100111', '100119', '1101', '110100'],
        keywords: ['wheat', 'meslin', 'flour'],
        type: 'goods'
    },
    // 6. Groceries: Barley
    {
        domain: 'barley',
        synonyms: ['barley', 'jau'],
        hsnPrefixes: ['1003', '100310', '100390'],
        keywords: ['barley'],
        type: 'goods'
    },
    // 7. Sugar & Salt
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

    // 8. Vegetables: Precision Categories
    {
        domain: 'tomato',
        synonyms: ['tomato', 'tomatoes', 'tamatar', 'thakkali'],
        hsnPrefixes: ['0702', '070200'],
        keywords: ['tomatoes'],
        type: 'goods'
    },
    {
        domain: 'potato',
        synonyms: ['potato', 'potatoes', 'aalu', 'urulaikizhangu'],
        hsnPrefixes: ['0701', '070110', '070190'],
        keywords: ['potatoes'],
        type: 'goods'
    },
    {
        domain: 'onion',
        synonyms: ['onion', 'onions', 'pyaaz', 'vengayam', 'shallots', 'garlic'],
        hsnPrefixes: ['0703', '070310', '070320'],
        keywords: ['onions', 'shallots', 'garlic'],
        type: 'goods'
    },
    {
        domain: 'other_vegetables',
        synonyms: [
            'carrot', 'cabbage', 'cauliflower', 'brinjal', 'eggplant', 'lady finger', 'bhindi', 'okra',
            'green chilli', 'chilli', 'spinach', 'palak', 'beans', 'peas', 'muttar', 'drumstick', 'pumpkin',
            'vegetables', 'veggies', 'sabzi'
        ],
        hsnPrefixes: ['0704', '0705', '0706', '0708', '0709', '0710'],
        keywords: ['vegetable', 'cabbages', 'carrots', 'leguminous', 'capsicum'],
        type: 'goods'
    },

    // 9. Electrical Goods
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
        synonyms: ['electric fan', 'fan', 'ceiling fan', 'table fan', 'exhaust fan'],
        hsnPrefixes: ['8414', '841451'],
        keywords: ['fans', 'ceiling fan', 'table fan'],
        type: 'goods'
    },

    // 10. Consumer Electronics: Precision Categories
    {
        domain: 'television',
        synonyms: ['tv', 'led tv', 'smart tv', 'television', 'monitors'],
        hsnPrefixes: ['8528', '852872', '852852'],
        keywords: ['reception apparatus for television', 'monitors'],
        type: 'goods'
    },
    {
        domain: 'refrigerator',
        synonyms: ['refrigerator', 'fridge', 'freezer'],
        hsnPrefixes: ['8418', '841810', '841821'],
        keywords: ['refrigerators', 'freezers'],
        type: 'goods'
    },
    {
        domain: 'washing_machine',
        synonyms: ['washing machine', 'washer'],
        hsnPrefixes: ['8450', '845011', '845012'],
        keywords: ['washing machines'],
        type: 'goods'
    },
    {
        domain: 'other_electronics',
        synonyms: ['microwave oven', 'oven', 'air conditioner', 'speaker', 'headphones', 'earphones', 'soundbar', 'camera', 'dslr', 'electronic equipment'],
        hsnPrefixes: ['8516', '8415', '8518', '8525'],
        keywords: ['microwave ovens', 'air conditioning', 'loudspeakers'],
        type: 'goods'
    },

    // 11. Clothing & Apparel
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

    // 12. Footwear
    {
        domain: 'footwear',
        synonyms: ['shoes', 'shoe', 'sports shoes', 'sandals', 'slippers', 'leather shoes', 'chappal', 'footwear', 'boots', 'sneakers'],
        hsnPrefixes: ['6401', '6402', '6403', '6404', '6405'],
        keywords: ['footwear', 'shoes', 'sandals', 'slippers', 'soles'],
        type: 'goods'
    },

    // 13. Hardware & Building Materials
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

    // 14. Furniture: Precision Categories
    {
        domain: 'chairs_furniture',
        synonyms: ['hotel chair', 'chair', 'office chair', 'seats', 'sofa'],
        hsnPrefixes: ['9401', '940161', '940171', '940180'],
        keywords: ['seats', 'chairs'],
        type: 'goods'
    },
    {
        domain: 'tables_furniture',
        synonyms: ['restaurant table', 'table', 'desk', 'wooden furniture', 'furniture', 'cupboard', 'bed'],
        hsnPrefixes: ['9403', '940330', '940360', '940310'],
        keywords: ['other furniture', 'wooden furniture', 'tables'],
        type: 'goods'
    },

    // 15. Stationery & Office Supplies
    {
        domain: 'stationery',
        synonyms: ['notebook', 'register', 'book', 'pen', 'pencil', 'eraser', 'marker', 'paper', 'printer paper', 'files', 'folder', 'envelope', 'stationery'],
        hsnPrefixes: ['4820', '9608', '9609', '4802'],
        keywords: ['registers', 'account books', 'notebooks', 'pens', 'pencils', 'paper'],
        type: 'goods'
    },

    // 16. Automobile, Vehicles & Spare Parts
    {
        domain: 'automobile_vehicles',
        synonyms: [
            'bmw', 'bmw car', 'bmw vehicle', 'bmw x5', 'bmw 3 series', 'toyota car', 'toyota',
            'hyundai', 'tata car', 'tata', 'mahindra', 'maruti', 'maruti suzuki', 'car',
            'automobile', 'motor car', 'vehicle', 'motor vehicle', 'bike', 'motorcycle', 'scooter',
            'engine oil', 'oil filter', 'air filter', 'lubricant', 'brake pad', 'clutch plate',
            'tyre', 'tire', 'battery', 'headlight', 'auto parts', 'spare parts', 'automobile parts'
        ],
        hsnPrefixes: ['8703', '8708', '8711', '8704', '2710', '4011', '8507', '8421', '8512'],
        keywords: ['motor cars', 'motor vehicles', 'parts and accessories of motor vehicles', 'pneumatic tyres'],
        type: 'goods'
    },

    // 17. Pharmacy & Medical Supplies
    {
        domain: 'pharmacy_medical',
        synonyms: ['medicine', 'pharma', 'tablet', 'capsule', 'syrup', 'antibiotic', 'drug', 'pharmaceutical', 'mask', 'bandage', 'syringe', 'medical equipment'],
        hsnPrefixes: ['3003', '3004', '3005', '9018'],
        keywords: ['medicaments', 'wadding', 'gauze', 'medical', 'surgical'],
        type: 'goods'
    },

    // 18. Meat, Poultry & Fish
    {
        domain: 'meat_poultry_fish',
        synonyms: ['chicken', 'mutton', 'meat', 'fish', 'prawns', 'egg', 'eggs'],
        hsnPrefixes: ['0207', '0204', '0302', '0303', '0407'],
        keywords: ['meat', 'poultry', 'fish', 'birds eggs'],
        type: 'goods'
    },

    // 19. Hotel, Restaurant & Catering Services (SAC)
    {
        domain: 'restaurant_hotel_services',
        synonyms: [
            'restaurant service', 'food service', 'catering service', 'hotel accommodation',
            'room service', 'banquet service', 'catering service', 'accommodation service'
        ],
        hsnPrefixes: ['9963', '996331', '996311', '996332', '996333'],
        keywords: ['services', 'restaurant', 'catering', 'accommodation'],
        type: 'services'
    }
];

function resolveSearchIntent(rawQuery) {
    const normalized = normalizeQuery(rawQuery);
    if (!normalized) {
        return {
            normalized,
            isNumeric: false,
            primaryPrefixes: [],
            mappedPrefixes: [],
            mappedKeywords: [],
            cleanTerms: []
        };
    }

    const isNumeric = /^\d+$/.test(normalized);
    const cleanTerms = cleanSearchTerms(normalized);

    if (isNumeric) {
        return {
            normalized,
            isNumeric: true,
            primaryPrefixes: [],
            mappedPrefixes: [],
            mappedKeywords: [],
            cleanTerms: []
        };
    }

    const words = normalized.split(' ').filter(Boolean);
    const matchedDomains = [];

    for (const item of DOMAIN_TAXONOMY) {
        let bestScore = 0;
        for (const syn of item.synonyms) {
            const normSyn = normalizeQuery(syn);
            if (!normSyn) continue;
            
            // Exact query match -> highest score 100
            if (normalized === normSyn) {
                bestScore = Math.max(bestScore, 100);
            }
            // Full phrase inclusion -> score 80 + length
            else if (normalized.includes(normSyn)) {
                bestScore = Math.max(bestScore, 80 + normSyn.length);
            }
            // Word level match
            else {
                for (const w of words) {
                    if (MODIFIER_WORDS.has(w)) continue;
                    if (w === normSyn) {
                        bestScore = Math.max(bestScore, 50 + normSyn.length);
                    } else if (w.length >= 4 && normSyn.length >= 4 && (w.startsWith(normSyn) || normSyn.startsWith(w))) {
                        bestScore = Math.max(bestScore, 30 + Math.min(w.length, normSyn.length));
                    }
                }
            }
        }

        if (bestScore > 0) {
            matchedDomains.push({
                domain: item.domain,
                score: bestScore,
                hsnPrefixes: item.hsnPrefixes,
                keywords: item.keywords
            });
        }
    }

    // Sort matched domains by match score descending
    matchedDomains.sort((a, b) => b.score - a.score);

    const primaryPrefixes = [];
    const mappedPrefixes = [];
    const mappedKeywords = [];

    for (let i = 0; i < matchedDomains.length; i++) {
        const dom = matchedDomains[i];
        for (const p of dom.hsnPrefixes) {
            if (i === 0 && !primaryPrefixes.includes(p)) {
                primaryPrefixes.push(p);
            }
            if (!mappedPrefixes.includes(p)) {
                mappedPrefixes.push(p);
            }
        }
        for (const k of dom.keywords) {
            if (!mappedKeywords.includes(k)) {
                mappedKeywords.push(k);
            }
        }
    }

    return {
        normalized,
        isNumeric: false,
        cleanTerms,
        primaryPrefixes,
        mappedPrefixes,
        mappedKeywords
    };
}

module.exports = {
    normalizeQuery,
    cleanSearchTerms,
    resolveSearchIntent,
    DOMAIN_TAXONOMY,
    MODIFIER_WORDS
};
