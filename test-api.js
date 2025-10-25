// Test script for Vacation Planner API
// Run with: node test-api.js

const testData = {
    travelers: [
        {
            name: "John Doe",
            type: "adult",
            nationality: "NG",
            residence: "NG",
            visas: ["USA", "UK"]
        },
        {
            name: "Jane Doe",
            type: "adult",
            nationality: "NG",
            residence: "NG",
            visas: []
        }
    ],
    budget: "1000-2000",
    timeframe: "1-3-months",
    duration: "5-7-days",
    departureCountry: "NG",
    visaPreference: "visa-on-arrival",
    travelStyles: ["beach-relaxation", "culture-history"]
};

async function testAPI() {
    console.log('Testing Vacation Planner API...\n');

    try {
        // Test 1: Health check
        console.log('1. Testing health endpoint...');
        const healthResponse = await fetch('http://localhost:3000/health');
        const healthData = await healthResponse.json();
        console.log('   ✓ Health check:', healthData);
        console.log();

        // Test 2: Create vacation planning task
        console.log('2. Creating vacation planning task...');
        const createResponse = await fetch('http://localhost:3000/api/plan-vacation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testData)
        });

        if (!createResponse.ok) {
            throw new Error(`Failed to create task: ${createResponse.status}`);
        }

        const { taskId, status } = await createResponse.json();
        console.log('   ✓ Task created:', taskId);
        console.log('   Status:', status);
        console.log();

        // Test 3: Poll for results
        console.log('3. Polling for results...');
        let attempts = 0;
        const maxAttempts = 60;

        while (attempts < maxAttempts) {
            attempts++;
            
            const taskResponse = await fetch(`http://localhost:3000/api/task/${taskId}`);
            const taskData = await taskResponse.json();
            
            console.log(`   Attempt ${attempts}: Status = ${taskData.status}`);

            if (taskData.status === 'completed') {
                console.log('\n   ✓ Task completed successfully!');
                console.log('\n   Results:');
                console.log('   -------');
                taskData.data.destinations.forEach((dest, index) => {
                    console.log(`\n   Destination ${index + 1}: ${dest.name}`);
                    console.log(`   - Visa Status: ${dest.visaStatus}`);
                    console.log(`   - Total Cost: $${dest.estimatedCost.total}`);
                    console.log(`   - Flight: ${dest.flightDetails.airline} ($${dest.estimatedCost.flights})`);
                    console.log(`   - Hotel: ${dest.accommodationSuggestion} ($${dest.estimatedCost.accommodation})`);
                    console.log(`   - Activities: $${dest.estimatedCost.activities}`);
                });
                return;
            } else if (taskData.status === 'failed') {
                console.log('\n   ✗ Task failed:', taskData.error);
                return;
            }

            // Wait 5 seconds before next poll
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        console.log('\n   ✗ Timeout: Task did not complete within expected time');

    } catch (error) {
        console.error('\n✗ Test failed:', error.message);
        console.error('\nMake sure:');
        console.error('1. Backend server is running (npm start)');
        console.error('2. OPENAI_API_KEY is set in .env file');
        console.error('3. Port 3000 is not in use by another application');
    }
}

// Run the test
testAPI();