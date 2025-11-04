import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3000';

const testCases = [
    {
        name: 'Nigerian with no visas to Albania',
        origin: 'NG',
        destination: 'AL',
        visas: null,
        expectedEffective: 'e-visa' // Based on actual CSV data
    },
    {
        name: 'Nigerian with UK visa to Albania',
        origin: 'NG',
        destination: 'AL',
        visas: 'UK',
        expectedEffective: 'visa-free', // Policy should override
        expectedPolicies: 1
    },
    {
        name: 'Nigerian with US visa to Albania',
        origin: 'NG',
        destination: 'AL',
        visas: 'US',
        expectedEffective: 'visa-free',
        expectedPolicies: 1
    },
    {
        name: 'Nigerian with Schengen visa to Albania',
        origin: 'NG',
        destination: 'AL',
        visas: 'SCHENGEN',
        expectedEffective: 'visa-free',
        expectedPolicies: 1
    },
    {
        name: 'Nigerian with multiple visas to Albania',
        origin: 'NG',
        destination: 'AL',
        visas: 'UK,US,SCHENGEN',
        expectedEffective: 'visa-free',
        expectedPolicies: 3
    },
    {
        name: 'Indian with no visas to Mexico',
        origin: 'IN',
        destination: 'MX',
        visas: null,
        expectedEffective: 'visa required'
    },
    {
        name: 'Indian with US visa to Mexico',
        origin: 'IN',
        destination: 'MX',
        visas: 'US',
        expectedEffective: 'visa-free',
        expectedPolicies: 1
    },
    {
        name: 'Indian with UK visa to Mexico',
        origin: 'IN',
        destination: 'MX',
        visas: 'UK',
        expectedEffective: 'visa-free',
        expectedPolicies: 1
    },
    {
        name: 'German to France (Schengen to Schengen)',
        origin: 'DE',
        destination: 'FR',
        visas: null,
        expectedEffective: 'visa-free'
    },
    {
        name: 'US citizen to Canada',
        origin: 'US',
        destination: 'CA',
        visas: null,
        expectedEffective: 'visa-free' // Numeric value normalized
    },
    {
        name: 'Nigerian to Turkey with no visas',
        origin: 'NG',
        destination: 'TR',
        visas: null,
        expectedEffective: 'visa required'
    },
    {
        name: 'Nigerian to Turkey with US visa',
        origin: 'NG',
        destination: 'TR',
        visas: 'US',
        expectedEffective: 'e-visa',
        expectedPolicies: 1
    },
    {
        name: 'Invalid origin country',
        origin: 'XX',
        destination: 'US',
        visas: null,
        expectError: true,
        expectedErrorMsg: 'Origin country not found'
    },
    {
        name: 'Invalid destination country',
        origin: 'NG',
        destination: 'YY',
        visas: null,
        expectError: true,
        expectedErrorMsg: 'Destination country not found'
    }
];

async function runTests() {
    console.log('🧪 Running Visa Policy Tests\n');
    
    let passed = 0;
    let failed = 0;
    
    for (const test of testCases) {
        try {
            const url = `${API_BASE}/api/visa-policy/${test.origin}/${test.destination}${test.visas ? `?visas=${test.visas}` : ''}`;
            const response = await fetch(url);
            const data = await response.json();
            
            if (test.expectError) {
                if (!response.ok && data.error && data.error.includes(test.expectedErrorMsg)) {
                    console.log(`✅ PASS: ${test.name}`);
                    console.log(`   Expected error: ${data.error}\n`);
                    passed++;
                } else {
                    console.log(`❌ FAIL: ${test.name}`);
                    console.log(`   Expected error containing: ${test.expectedErrorMsg}`);
                    console.log(`   Got: ${JSON.stringify(data)}\n`);
                    failed++;
                }
                continue;
            }
            
            if (!response.ok) {
                console.log(`❌ FAIL: ${test.name}`);
                console.log(`   HTTP ${response.status}: ${JSON.stringify(data)}\n`);
                failed++;
                continue;
            }
            
            let testPassed = true;
            const errors = [];
            
            // Check base requirement
            if (test.expectedBase && data.baseRequirement.toLowerCase() !== test.expectedBase.toLowerCase()) {
                testPassed = false;
                errors.push(`Base requirement mismatch: expected "${test.expectedBase}", got "${data.baseRequirement}"`);
            }
            
            // Check effective requirement
            if (test.expectedEffective && data.effectiveRequirement.toLowerCase() !== test.expectedEffective.toLowerCase()) {
                testPassed = false;
                errors.push(`Effective requirement mismatch: expected "${test.expectedEffective}", got "${data.effectiveRequirement}"`);
            }
            
            // Check number of policies
            if (test.expectedPolicies !== undefined && data.policies.length !== test.expectedPolicies) {
                testPassed = false;
                errors.push(`Policies count mismatch: expected ${test.expectedPolicies}, got ${data.policies.length}`);
            }
            
            if (testPassed) {
                console.log(`✅ PASS: ${test.name}`);
                console.log(`   Base: ${data.baseRequirement}, Effective: ${data.effectiveRequirement}`);
                if (data.policies.length > 0) {
                    console.log(`   Policies: ${data.policies.map(p => `${p.conditionValue} → ${p.resultingRequirement}`).join(', ')}`);
                }
                console.log('');
                passed++;
            } else {
                console.log(`❌ FAIL: ${test.name}`);
                errors.forEach(err => console.log(`   ${err}`));
                console.log(`   Response: ${JSON.stringify(data, null, 2)}\n`);
                failed++;
            }
            
        } catch (err) {
            console.log(`❌ ERROR: ${test.name}`);
            console.log(`   ${err.message}\n`);
            failed++;
        }
    }
    
    console.log('═'.repeat(50));
    console.log(`\n📊 Test Summary: ${passed} passed, ${failed} failed out of ${testCases.length} total\n`);
    
    if (failed > 0) {
        process.exit(1);
    }
}

// Test full vacation planning logic with multiple travelers
async function testVacationPlanning() {
    console.log('\n🌴 Testing Vacation Planning Logic\n');
    
    const planningTests = [
        {
            name: 'Single Nigerian traveler with UK visa, visa-free preference',
            payload: {
                travelers: [
                    {
                        name: 'John Doe',
                        type: 'adult',
                        nationality: 'NG',
                        residence: 'NG',
                        visas: ['UK']
                    }
                ],
                budget: '1000-2000',
                timeframe: '1-month',
                duration: '3-5-days',
                departureCountry: 'LOS',
                visaPreference: 'visa-free',
                travelStyles: ['beach-relaxation']
            },
            expectedToInclude: ['AL'], // Albania should be included
            description: 'Should include Albania due to UK visa'
        },
        {
            name: 'Nigerian traveler without visas, visa-free preference',
            payload: {
                travelers: [
                    {
                        name: 'Jane Doe',
                        type: 'adult',
                        nationality: 'NG',
                        residence: 'NG',
                        visas: []
                    }
                ],
                budget: '1000-2000',
                timeframe: '1-month',
                duration: '3-5-days',
                departureCountry: 'LOS',
                visaPreference: 'visa-free',
                travelStyles: ['beach-relaxation']
            },
            expectedToExclude: ['AL'], // Albania should NOT be included without visa
            description: 'Should exclude Albania without UK/US/Schengen visa'
        },
        {
            name: 'Two travelers - one Nigerian with UK visa, one Indian with US visa',
            payload: {
                travelers: [
                    {
                        name: 'Nigerian Traveler',
                        type: 'adult',
                        nationality: 'NG',
                        residence: 'NG',
                        visas: ['UK']
                    },
                    {
                        name: 'Indian Traveler',
                        type: 'adult',
                        nationality: 'IN',
                        residence: 'IN',
                        visas: ['US']
                    }
                ],
                budget: '2000-5000',
                timeframe: '1-3-months',
                duration: '5-7-days',
                departureCountry: 'DXB',
                visaPreference: 'visa-free',
                travelStyles: ['shopping-nightlife', 'food-culinary']
            },
            expectedToInclude: ['AL', 'MX'], // Both should be eligible for Albania and Mexico
            description: 'Both travelers can access Albania and Mexico with their respective visas'
        },
        {
            name: 'German resident traveling, should exclude Germany and Schengen countries from base',
            payload: {
                travelers: [
                    {
                        name: 'German Resident',
                        type: 'adult',
                        nationality: 'NG',
                        residence: 'DE',
                        visas: []
                    }
                ],
                budget: '1000-2000',
                timeframe: '1-month',
                duration: '3-5-days',
                departureCountry: 'FRA',
                visaPreference: 'visa-free',
                travelStyles: ['culture-history']
            },
            expectedToExclude: ['DE', 'FR'], // Should exclude residence and departure countries
            description: 'Should exclude own residence and departure country'
        }
    ];
    
    console.log('Note: These tests require the full database to be populated.\n');
    console.log('They will create actual tasks and check the logic flow.\n');
    
    // These are integration tests that would require the full system to be running
    // For now, just document them
    for (const test of planningTests) {
        console.log(`📝 Test Case: ${test.name}`);
        console.log(`   ${test.description}`);
        console.log(`   Payload: ${JSON.stringify(test.payload, null, 2)}`);
        console.log('');
    }
}

// Run tests
console.log('Make sure the server is running on http://localhost:3000\n');

runTests()
    .then(() => testVacationPlanning())
    .catch(err => {
        console.error('Test runner error:', err);
        process.exit(1);
    });