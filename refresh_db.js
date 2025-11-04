// run node script
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define import scripts in order of execution
const importScripts = [
    {
        name: 'Import Countries',
        script: './importers/import_countries.js',
        description: 'Imports country data with travel style attributes'
    },
    {
        name: 'Import Airports',
        script: './importers/import_airport_codes.js',
        description: 'Imports airpots with IATA code'
    },
    {
        name: 'Import Visa Requirements',
        script: './importers/import_visa_requirements.js',
        description: 'Imports base visa requirements from CSV'
    },
    {
        name: 'Normalize Visa Data',
        script: './importers/normalize_visa_data.js',
        description: 'Normalizes visa requirement values'
    },
    {
        name: 'Import Destination Policies',
        script: './importers/import_destination_policies.js',
        description: 'Imports conditional visa policies'
    },
    {
        name: 'Populate Travel Styles',
        script: './importers/populate_travel_styles.js',
        description: 'Populates travel style attributes for countries'
    }
];

function runScript(scriptPath) {
    return new Promise((resolve, reject) => {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Running: ${scriptPath}`);
        console.log('='.repeat(60));

        const child = spawn('node', [scriptPath], {
            cwd: __dirname,
            stdio: 'inherit'
        });

        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Script ${scriptPath} exited with code ${code}`));
            } else {
                resolve();
            }
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
}

async function runAllImports() {
    console.log('🚀 Starting data import process...\n');

    const startTime = Date.now();
    let completed = 0;
    let failed = 0;

    for (const { name, script, description } of importScripts) {
        try {
            console.log(`\n📦 [${completed + 1}/${importScripts.length}] ${name}`);
            console.log(`   ${description}`);

            await runScript(script);
            completed++;
            console.log(`   ✅ Success`);
        } catch (err) {
            failed++;
            console.error(`   ❌ Failed: ${err.message}`);

            // Ask if user wants to continue
            const shouldContinue = process.argv.includes('--continue-on-error');
            if (!shouldContinue) {
                console.error('\n❌ Import process stopped due to error.');
                console.error('   Use --continue-on-error flag to continue on errors.\n');
                process.exit(1);
            }
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(60));
    console.log('📊 Import Summary');
    console.log('='.repeat(60));
    console.log(`Total scripts: ${importScripts.length}`);
    console.log(`✅ Completed: ${completed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log('='.repeat(60) + '\n');

    if (failed > 0) {
        console.error('⚠️  Some imports failed. Please check the logs above.\n');
        process.exit(1);
    } else {
        console.log('✅ All imports completed successfully!\n');
    }
}

// Run the imports
runAllImports().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});