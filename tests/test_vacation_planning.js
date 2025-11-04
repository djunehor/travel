import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3000';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollTaskStatus(taskId, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        const response = await fetch(`${API_BASE}/api/task/${taskId}`);
        const data = await response.json();
        
        if (data.status === 'completed' || data.status === 'failed') {
            return data;
        }
        
        console.log(`   Polling... Status: ${data.status}`);
        await sleep(2000);
    }
    
    throw new Error('Task timed out');
}

const integrationTests = [
    {
        name: 'Nigerian with UK visa should get Albania',
        payload: {
            travelers: [{
                name: 'John Doe',
                type: 'adult',
                nationality: 'NG',
                residence: 'NG',
                visas: ['UK']
            }],
            budget: '1000-2000',
            timeframe: '1-month',
            duration: '3-5-days',
            departureCountry: 'LOS',
            visaPreference: 'visa-free',
            travelStyles: ['beach-relaxation']
        },
        expectedToInclude: ['AL'],
        expectedToExclude: ['NG']
    },
    {
        name: 'Nigerian without visas, visa-free preference',
        payload: {
            travelers: [{
                name: 'Jane Doe',
                type: 'adult',
                nationality: 'NG',
                residence: 'NG',
                visas: []
            }],
            budget: '1000-2000',
            timeframe: '1-month',
            duration: '3-5-days',
            departureCountry: 'LOS',
            visaPreference: 'visa-free',
            travelStyles: ['beach-relaxation']
        },
        expectedToExclude: ['AL', 'NG'] // No UK visa, so no Albania
    },
    {
        name: 'Two travelers with different visas',
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
        expectedToInclude: ['AL', 'MX'], // Both have visa-free access
        expectedToExclude: ['NG', 'IN']
    },
    {
        name: 'German resident (Nigerian passport)',
        payload: {
            travelers: [{
                name: 'German Resident',
                type: 'adult',
                nationality: 'NG',
                residence: 'DE',
                visas: []
            }],
            budget: '1000-2000',
            timeframe: '1-month',
            duration: '3-5-days',
            departureCountry: 'FRA',
            visaPreference: 'visa-free',
            travelStyles: ['culture-history']
        },
        expectedToExclude: ['DE', 'FR', 'NG'], // Exclude residence, departure, nationality
        // Should include other Schengen countries due to German residence
    }
];

async function runIntegrationTests() {
    console.log('🌴 Running Vacation Planning Integration Tests\n');
    console.log('Note: These tests create actual tasks and check real destinations\n');
    
    let passed = 0;
    let failed = 0;
    
    for (const test of integrationTests) {
        console.log(`🧪 Test: ${test.name}`);
        
        try {
            // Create task
            const createResponse = await fetch(`${API_BASE}/api/plan-vacation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(test.payload)
            });
            
            if (!createResponse.ok) {
                const error = await createResponse.json();
                console.log(`❌ FAIL: Failed to create task - ${error.error}\n`);
                failed++;
                continue;
            }
            
            const { taskId } = await createResponse.json();
            console.log(`   Task ID: ${taskId}`);
            
            // Poll for completion
            const result = await pollTaskStatus(taskId);
            
            if (result.status === 'failed') {
                console.log(`❌ FAIL: Task failed - ${result.error}\n`);
                failed++;
                continue;
            }
            
            if (!result.data || !result.data.destinations) {
                console.log(`❌ FAIL: No destinations returned\n`);
                failed++;
                continue;
            }
            
            const destinationCodes = result.data.destinations.map(d => d.countryCode);
            console.log(`   Found destinations: ${destinationCodes.join(', ')}`);
            
            let testPassed = true;
            const errors = [];
            
            // Check expected inclusions
            if (test.expectedToInclude) {
                for (const code of test.expectedToInclude) {
                    if (!destinationCodes.includes(code)) {
                        testPassed = false;
                        errors.push(`Expected to include ${code} but it was not found`);
                    }
                }
            }
            
            // Check expected exclusions
            if (test.expectedToExclude) {
                for (const code of test.expectedToExclude) {
                    if (destinationCodes.includes(code)) {
                        testPassed = false;
                        errors.push(`Expected to exclude ${code} but it was found`);
                    }
                }
            }
            
            if (testPassed) {
                console.log(`✅ PASS\n`);
                passed++;
            } else {
                console.log(`❌ FAIL:`);
                errors.forEach(err => console.log(`   ${err}`));
                console.log('');
                failed++;
            }
            
        } catch (err) {
            console.log(`❌ ERROR: ${err.message}\n`);
            failed++;
        }
    }
    
    console.log('═'.repeat(50));
    console.log(`\n📊 Integration Test Summary: ${passed} passed, ${failed} failed out of ${integrationTests.length} total\n`);
    
    if (failed > 0) {
        process.exit(1);
    }
}

console.log('Make sure the server is running on http://localhost:3000\n');
runIntegrationTests().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});