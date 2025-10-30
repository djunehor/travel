
let currentStep = 1;
let totalSteps = 8;
let travelers = [];
const baseUrl = 'https://vacation-planner.shagital.com';

const form = document.getElementById('vacationForm');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const submitBtn = document.getElementById('submitBtn');
const formContainer = document.getElementById('formContainer');
const resultsContainer = document.getElementById('resultsContainer');
const loadingSpinner = document.getElementById('loadingSpinner');
const newSearchBtn = document.getElementById('newSearchBtn');

// Country list for dropdowns
const countries = [
    { code: 'AF', name: 'Afghanistan' },
    { code: 'AX', name: 'Åland Islands' },
    { code: 'AL', name: 'Albania' },
    { code: 'DZ', name: 'Algeria' },
    { code: 'AS', name: 'American Samoa' },
    { code: 'AD', name: 'Andorra' },
    { code: 'AO', name: 'Angola' },
    { code: 'AI', name: 'Anguilla' },
    { code: 'AQ', name: 'Antarctica' },
    { code: 'AG', name: 'Antigua and Barbuda' },
    { code: 'AR', name: 'Argentina' },
    { code: 'AM', name: 'Armenia' },
    { code: 'AW', name: 'Aruba' },
    { code: 'AU', name: 'Australia' },
    { code: 'AT', name: 'Austria' },
    { code: 'AZ', name: 'Azerbaijan' },
    { code: 'BS', name: 'Bahamas' },
    { code: 'BH', name: 'Bahrain' },
    { code: 'BD', name: 'Bangladesh' },
    { code: 'BB', name: 'Barbados' },
    { code: 'BY', name: 'Belarus' },
    { code: 'BE', name: 'Belgium' },
    { code: 'BZ', name: 'Belize' },
    { code: 'BJ', name: 'Benin' },
    { code: 'BM', name: 'Bermuda' },
    { code: 'BT', name: 'Bhutan' },
    { code: 'BO', name: 'Bolivia (Plurinational State of)' },
    { code: 'BQ', name: 'Bonaire, Sint Eustatius and Saba' },
    { code: 'BA', name: 'Bosnia and Herzegovina' },
    { code: 'BW', name: 'Botswana' },
    { code: 'BV', name: 'Bouvet Island' },
    { code: 'BR', name: 'Brazil' },
    { code: 'IO', name: 'British Indian Ocean Territory' },
    { code: 'BN', name: 'Brunei Darussalam' },
    { code: 'BG', name: 'Bulgaria' },
    { code: 'BF', name: 'Burkina Faso' },
    { code: 'BI', name: 'Burundi' },
    { code: 'CV', name: 'Cabo Verde' },
    { code: 'KH', name: 'Cambodia' },
    { code: 'CM', name: 'Cameroon' },
    { code: 'CA', name: 'Canada' },
    { code: 'KY', name: 'Cayman Islands' },
    { code: 'CF', name: 'Central African Republic' },
    { code: 'TD', name: 'Chad' },
    { code: 'CL', name: 'Chile' },
    { code: 'CN', name: 'China' },
    { code: 'CX', name: 'Christmas Island' },
    { code: 'CC', name: 'Cocos (Keeling) Islands' },
    { code: 'CO', name: 'Colombia' },
    { code: 'KM', name: 'Comoros' },
    { code: 'CG', name: 'Congo' },
    { code: 'CD', name: 'Congo, Democratic Republic of the' },
    { code: 'CK', name: 'Cook Islands' },
    { code: 'CR', name: 'Costa Rica' },
    { code: 'CI', name: 'Côte d’Ivoire' },
    { code: 'HR', name: 'Croatia' },
    { code: 'CU', name: 'Cuba' },
    { code: 'CW', name: 'Curaçao' },
    { code: 'CY', name: 'Cyprus' },
    { code: 'CZ', name: 'Czechia' },
    { code: 'DK', name: 'Denmark' },
    { code: 'DJ', name: 'Djibouti' },
    { code: 'DM', name: 'Dominica' },
    { code: 'DO', name: 'Dominican Republic' },
    { code: 'EC', name: 'Ecuador' },
    { code: 'EG', name: 'Egypt' },
    { code: 'SV', name: 'El Salvador' },
    { code: 'GQ', name: 'Equatorial Guinea' },
    { code: 'ER', name: 'Eritrea' },
    { code: 'EE', name: 'Estonia' },
    { code: 'SZ', name: 'Eswatini' },
    { code: 'ET', name: 'Ethiopia' },
    { code: 'FK', name: 'Falkland Islands (Malvinas)' },
    { code: 'FO', name: 'Faroe Islands' },
    { code: 'FJ', name: 'Fiji' },
    { code: 'FI', name: 'Finland' },
    { code: 'FR', name: 'France' },
    { code: 'GF', name: 'French Guiana' },
    { code: 'PF', name: 'French Polynesia' },
    { code: 'TF', name: 'French Southern Territories' },
    { code: 'GA', name: 'Gabon' },
    { code: 'GM', name: 'Gambia' },
    { code: 'GE', name: 'Georgia' },
    { code: 'DE', name: 'Germany' },
    { code: 'GH', name: 'Ghana' },
    { code: 'GI', name: 'Gibraltar' },
    { code: 'GR', name: 'Greece' },
    { code: 'GL', name: 'Greenland' },
    { code: 'GD', name: 'Grenada' },
    { code: 'GP', name: 'Guadeloupe' },
    { code: 'GU', name: 'Guam' },
    { code: 'GT', name: 'Guatemala' },
    { code: 'GG', name: 'Guernsey' },
    { code: 'GN', name: 'Guinea' },
    { code: 'GW', name: 'Guinea-Bissau' },
    { code: 'GY', name: 'Guyana' },
    { code: 'HT', name: 'Haiti' },
    { code: 'HM', name: 'Heard Island and McDonald Islands' },
    { code: 'VA', name: 'Holy See' },
    { code: 'HN', name: 'Honduras' },
    { code: 'HK', name: 'Hong Kong' },
    { code: 'HU', name: 'Hungary' },
    { code: 'IS', name: 'Iceland' },
    { code: 'IN', name: 'India' },
    { code: 'ID', name: 'Indonesia' },
    { code: 'IR', name: 'Iran (Islamic Republic of)' },
    { code: 'IQ', name: 'Iraq' },
    { code: 'IE', name: 'Ireland' },
    { code: 'IM', name: 'Isle of Man' },
    { code: 'IL', name: 'Israel' },
    { code: 'IT', name: 'Italy' },
    { code: 'JM', name: 'Jamaica' },
    { code: 'JP', name: 'Japan' },
    { code: 'JE', name: 'Jersey' },
    { code: 'JO', name: 'Jordan' },
    { code: 'KZ', name: 'Kazakhstan' },
    { code: 'KE', name: 'Kenya' },
    { code: 'KI', name: 'Kiribati' },
    { code: 'KP', name: 'Korea (Democratic People’s Republic of)' },
    { code: 'KR', name: 'Korea (Republic of)' },
    { code: 'KW', name: 'Kuwait' },
    { code: 'KG', name: 'Kyrgyzstan' },
    { code: 'LA', name: 'Lao People’s Democratic Republic' },
    { code: 'LV', name: 'Latvia' },
    { code: 'LB', name: 'Lebanon' },
    { code: 'LS', name: 'Lesotho' },
    { code: 'LR', name: 'Liberia' },
    { code: 'LY', name: 'Libya' },
    { code: 'LI', name: 'Liechtenstein' },
    { code: 'LT', name: 'Lithuania' },
    { code: 'LU', name: 'Luxembourg' },
    { code: 'MO', name: 'Macao' },
    { code: 'MG', name: 'Madagascar' },
    { code: 'MW', name: 'Malawi' },
    { code: 'MY', name: 'Malaysia' },
    { code: 'MV', name: 'Maldives' },
    { code: 'ML', name: 'Mali' },
    { code: 'MT', name: 'Malta' },
    { code: 'MH', name: 'Marshall Islands' },
    { code: 'MQ', name: 'Martinique' },
    { code: 'MR', name: 'Mauritania' },
    { code: 'MU', name: 'Mauritius' },
    { code: 'YT', name: 'Mayotte' },
    { code: 'MX', name: 'Mexico' },
    { code: 'FM', name: 'Micronesia (Federated States of)' },
    { code: 'MD', name: 'Moldova (Republic of)' },
    { code: 'MC', name: 'Monaco' },
    { code: 'MN', name: 'Mongolia' },
    { code: 'ME', name: 'Montenegro' },
    { code: 'MS', name: 'Montserrat' },
    { code: 'MA', name: 'Morocco' },
    { code: 'MZ', name: 'Mozambique' },
    { code: 'MM', name: 'Myanmar' },
    { code: 'NA', name: 'Namibia' },
    { code: 'NR', name: 'Nauru' },
    { code: 'NP', name: 'Nepal' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'NC', name: 'New Caledonia' },
    { code: 'NZ', name: 'New Zealand' },
    { code: 'NI', name: 'Nicaragua' },
    { code: 'NE', name: 'Niger' },
    { code: 'NG', name: 'Nigeria' },
    { code: 'NU', name: 'Niue' },
    { code: 'NF', name: 'Norfolk Island' },
    { code: 'MK', name: 'North Macedonia' },
    { code: 'MP', name: 'Northern Mariana Islands' },
    { code: 'NO', name: 'Norway' },
    { code: 'OM', name: 'Oman' },
    { code: 'PK', name: 'Pakistan' },
    { code: 'PW', name: 'Palau' },
    { code: 'PS', name: 'Palestine, State of' },
    { code: 'PA', name: 'Panama' },
    { code: 'PG', name: 'Papua New Guinea' },
    { code: 'PY', name: 'Paraguay' },
    { code: 'PE', name: 'Peru' },
    { code: 'PH', name: 'Philippines' },
    { code: 'PN', name: 'Pitcairn' },
    { code: 'PL', name: 'Poland' },
    { code: 'PT', name: 'Portugal' },
    { code: 'PR', name: 'Puerto Rico' },
    { code: 'QA', name: 'Qatar' },
    { code: 'RE', name: 'Réunion' },
    { code: 'RO', name: 'Romania' },
    { code: 'RU', name: 'Russian Federation' },
    { code: 'RW', name: 'Rwanda' },
    { code: 'BL', name: 'Saint-Barthélemy' },
    { code: 'SH', name: 'Saint Helena, Ascension and Tristan da Cunha' },
    { code: 'KN', name: 'Saint Kitts and Nevis' },
    { code: 'LC', name: 'Saint Lucia' },
    { code: 'MF', name: 'Saint Martin (French part)' },
    { code: 'PM', name: 'Saint Pierre and Miquelon' },
    { code: 'VC', name: 'Saint Vincent and the Grenadines' },
    { code: 'WS', name: 'Samoa' },
    { code: 'SM', name: 'San Marino' },
    { code: 'ST', name: 'Sao Tome and Principe' },
    { code: 'SA', name: 'Saudi Arabia' },
    { code: 'SN', name: 'Senegal' },
    { code: 'RS', name: 'Serbia' },
    { code: 'SC', name: 'Seychelles' },
    { code: 'SL', name: 'Sierra Leone' },
    { code: 'SG', name: 'Singapore' },
    { code: 'SX', name: 'Sint Maarten (Dutch part)' },
    { code: 'SK', name: 'Slovakia' },
    { code: 'SI', name: 'Slovenia' },
    { code: 'SB', name: 'Solomon Islands' },
    { code: 'SO', name: 'Somalia' },
    { code: 'ZA', name: 'South Africa' },
    { code: 'GS', name: 'South Georgia and the South Sandwich Islands' },
    { code: 'SS', name: 'South Sudan' },
    { code: 'ES', name: 'Spain' },
    { code: 'LK', name: 'Sri Lanka' },
    { code: 'SD', name: 'Sudan' },
    { code: 'SR', name: 'Suriname' },
    { code: 'SJ', name: 'Svalbard and Jan Mayen' },
    { code: 'SE', name: 'Sweden' },
    { code: 'CH', name: 'Switzerland' },
    { code: 'SY', name: 'Syrian Arab Republic' },
    { code: 'TW', name: 'Taiwan, Province of China' },
    { code: 'TJ', name: 'Tajikistan' },
    { code: 'TZ', name: 'Tanzania, United Republic of' },
    { code: 'TH', name: 'Thailand' },
    { code: 'TL', name: 'Timor-Leste' },
    { code: 'TG', name: 'Togo' },
    { code: 'TK', name: 'Tokelau' },
    { code: 'TO', name: 'Tonga' },
    { code: 'TT', name: 'Trinidad and Tobago' },
    { code: 'TN', name: 'Tunisia' },
    { code: 'TR', name: 'Türkiye' },
    { code: 'TM', name: 'Turkmenistan' },
    { code: 'TC', name: 'Turks and Caicos Islands' },
    { code: 'TV', name: 'Tuvalu' },
    { code: 'UG', name: 'Uganda' },
    { code: 'UA', name: 'Ukraine' },
    { code: 'AE', name: 'United Arab Emirates' },
    { code: 'GB', name: 'United Kingdom of Great Britain and Northern Ireland' },
    { code: 'US', name: 'United States of America' },
    { code: 'UM', name: 'United States Minor Outlying Islands' },
    { code: 'UY', name: 'Uruguay' },
    { code: 'UZ', name: 'Uzbekistan' },
    { code: 'VU', name: 'Vanuatu' },
    { code: 'VE', name: 'Venezuela (Bolivarian Republic of)' },
    { code: 'VN', name: 'Viet Nam' },
    { code: 'VG', name: 'Virgin Islands (British)' },
    { code: 'VI', name: 'Virgin Islands (U.S.)' },
    { code: 'WF', name: 'Wallis and Futuna' },
    { code: 'EH', name: 'Western Sahara' },
    { code: 'YE', name: 'Yemen' },
    { code: 'ZM', name: 'Zambia' },
    { code: 'ZW', name: 'Zimbabwe' }
];

function updateProgress() {
    const progress = ((currentStep - 1) / (totalSteps - 1)) * 100;
    document.getElementById('progressFill').style.width = progress + '%';
    document.getElementById('currentStep').textContent = currentStep;
    document.getElementById('totalSteps').textContent = totalSteps;
    document.getElementById('progressPercent').textContent = Math.round(progress);
}

function showStep(step) {
    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    const stepElement = document.querySelector(`[data-step="${step}"]`);
    if (stepElement) {
        stepElement.classList.add('active');
    }

    // Update button visibility
    prevBtn.classList.toggle('hidden', step === 1);

    if (step === totalSteps) {
        nextBtn.classList.add('hidden');
        submitBtn.classList.remove('hidden');
    } else {
        nextBtn.classList.remove('hidden');
        submitBtn.classList.add('hidden');
    }

    currentStep = step;
    updateProgress();
}

function generateTravelerDetailsForm() {
    const numAdults = parseInt(document.getElementById('numAdults').value) || 0;
    const numChildren = parseInt(document.getElementById('numChildren').value) || 0;
    const numInfants = parseInt(document.getElementById('numInfants').value) || 0;

    const totalTravelers = numAdults + numChildren + numInfants;

    if (totalTravelers === 0) {
        alert('Please add at least one traveler');
        return false;
    }

    travelers = [];
    const container = document.getElementById('travelerDetailsContainer');
    container.innerHTML = '';

    let travelerIndex = 0;

    // Generate forms for adults
    for (let i = 0; i < numAdults; i++) {
        travelers.push({ type: 'adult', index: i });
        container.innerHTML += generateTravelerForm('adult', i, travelerIndex);
        travelerIndex++;
    }

    // Generate forms for children
    for (let i = 0; i < numChildren; i++) {
        travelers.push({ type: 'child', index: i });
        container.innerHTML += generateTravelerForm('child', i, travelerIndex);
        travelerIndex++;
    }

    // Generate forms for infants
    for (let i = 0; i < numInfants; i++) {
        travelers.push({ type: 'infant', index: i });
        container.innerHTML += generateTravelerForm('infant', i, travelerIndex);
        travelerIndex++;
    }

    return true;
}

function generateTravelerForm(type, index, travelerIndex) {
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
    const defaultName = `${typeLabel} ${index + 1}`;

    const countryOptions = countries.map(c =>
        `<option value="${c.code}" ${c.code === 'NG' ? 'selected' : ''}>${c.name}</option>`
    ).join('');

    return `
                <div class="traveler-form mb-8 pb-8 ${travelerIndex > 0 ? 'border-t border-gray-200 pt-8' : ''}">
                    <h3 class="text-xl font-semibold text-gray-900 mb-4">${typeLabel} ${index + 1}</h3>
                    
                    <div class="space-y-4">
                        <div class="hidden">
                            <label class="block text-sm font-medium text-gray-700 mb-2">Name (optional)</label>
                            <input type="text" name="traveler_${travelerIndex}_name" placeholder="${defaultName}"
                                class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Nationality</label>
                            <select name="traveler_${travelerIndex}_nationality" required
                                class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                                ${countryOptions}
                            </select>
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Country of Residence</label>
                            <select name="traveler_${travelerIndex}_residence" required
                                class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                                ${countryOptions}
                            </select>
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Valid Visas Held</label>
                            <p class="text-xs text-gray-600 mb-2">Select all that apply</p>
                            <div class="space-y-2">
                                <label class="flex items-center">
                                    <input type="checkbox" name="traveler_${travelerIndex}_visa_usa" value="USA" class="mr-2 h-4 w-4 text-blue-600">
                                    <span class="text-sm text-gray-700">USA</span>
                                </label>
                                <label class="flex items-center">
                                    <input type="checkbox" name="traveler_${travelerIndex}_visa_uk" value="UK" class="mr-2 h-4 w-4 text-blue-600">
                                    <span class="text-sm text-gray-700">United Kingdom</span>
                                </label>
                                <label class="flex items-center">
                                    <input type="checkbox" name="traveler_${travelerIndex}_visa_schengen" value="Schengen" class="mr-2 h-4 w-4 text-blue-600">
                                    <span class="text-sm text-gray-700">Schengen (EU)</span>
                                </label>
                                <label class="flex items-center">
                                    <input type="checkbox" name="traveler_${travelerIndex}_visa_canada" value="Canada" class="mr-2 h-4 w-4 text-blue-600">
                                    <span class="text-sm text-gray-700">Canada</span>
                                </label>
                                <label class="flex items-center">
                                    <input type="checkbox" name="traveler_${travelerIndex}_visa_australia" value="Australia" class="mr-2 h-4 w-4 text-blue-600">
                                    <span class="text-sm text-gray-700">Australia</span>
                                </label>
                                <div class="flex items-center space-x-2">
                                    <input type="checkbox" name="traveler_${travelerIndex}_visa_other_check" value="other" class="h-4 w-4 text-blue-600"
                                        onchange="document.getElementById('traveler_${travelerIndex}_visa_other_input').disabled = !this.checked">
                                    <span class="text-sm text-gray-700">Other:</span>
                                    <input type="text" id="traveler_${travelerIndex}_visa_other_input" name="traveler_${travelerIndex}_visa_other" placeholder="Country name" disabled
                                        class="flex-1 px-2 py-1 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
}

function validateCurrentStep() {
    if (currentStep === 1) {
        const numAdults = parseInt(document.getElementById('numAdults').value) || 0;
        const numChildren = parseInt(document.getElementById('numChildren').value) || 0;
        const numInfants = parseInt(document.getElementById('numInfants').value) || 0;

        if (numAdults + numChildren + numInfants === 0) {
            alert('Please add at least one traveler');
            return false;
        }
        return generateTravelerDetailsForm();
    }

    if (currentStep === 2) {
        // Validate that all required traveler fields are filled
        const requiredFields = document.querySelectorAll('[data-step="2"] select[required]');
        for (let field of requiredFields) {
            if (!field.value) {
                alert('Please fill in all required traveler information');
                return false;
            }
        }
    }

    if (currentStep === 7) {
        const visaPreference = document.querySelector('input[name="visaPreference"]:checked');
        if (!visaPreference) {
            alert('Please select a visa preference');
            return false;
        }
    }

    if (currentStep === 8) {
        const travelStyles = document.querySelectorAll('input[name="travelStyle"]:checked');
        if (travelStyles.length === 0) {
            alert('Please select at least one travel style');
            return false;
        }
    }

    return true;
}

function collectFormData() {
    const formData = {
        travelers: [],
        budget: document.getElementById('budget').value,
        timeframe: document.getElementById('timeframe').value,
        duration: document.getElementById('duration').value,
        departureCountry: document.getElementById('departureCountry').value,
        visaPreference: document.querySelector('input[name="visaPreference"]:checked').value,
        travelStyles: Array.from(document.querySelectorAll('input[name="travelStyle"]:checked')).map(cb => cb.value)
    };

    // Collect traveler data
    travelers.forEach((traveler, index) => {
        const nameField = document.querySelector(`input[name="traveler_${index}_name"]`);
        const name = nameField.value || nameField.placeholder;
        const nationality = document.querySelector(`select[name="traveler_${index}_nationality"]`).value;
        const residence = document.querySelector(`select[name="traveler_${index}_residence"]`).value;

        const visas = [];
        if (document.querySelector(`input[name="traveler_${index}_visa_usa"]`).checked) visas.push('USA');
        if (document.querySelector(`input[name="traveler_${index}_visa_uk"]`).checked) visas.push('UK');
        if (document.querySelector(`input[name="traveler_${index}_visa_schengen"]`).checked) visas.push('Schengen');
        if (document.querySelector(`input[name="traveler_${index}_visa_canada"]`).checked) visas.push('Canada');
        if (document.querySelector(`input[name="traveler_${index}_visa_australia"]`).checked) visas.push('Australia');

        const otherVisaCheck = document.querySelector(`input[name="traveler_${index}_visa_other_check"]`);
        if (otherVisaCheck && otherVisaCheck.checked) {
            const otherVisa = document.querySelector(`input[name="traveler_${index}_visa_other"]`).value;
            if (otherVisa) visas.push(otherVisa);
        }

        formData.travelers.push({
            name,
            type: traveler.type,
            nationality,
            residence,
            visas
        });
    });

    return formData;
}

async function submitForm() {
    const formData = collectFormData();

    // Show loading spinner
    loadingSpinner.classList.remove('hidden');

    try {
        // Call API to create task
        const response = await fetch(`${baseUrl}/api/plan-vacation`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(formData)
        });

        if (!response.ok) {
            throw new Error('Failed to create vacation planning task');
        }

        const { taskId } = await response.json();
        console.log(new Date().toLocaleString(), 'Task created:', taskId);

        // Poll for results
        await pollTaskStatus(taskId);

    } catch (error) {
        loadingSpinner.classList.add('hidden');
        alert('An error occurred. Please try again.');
        console.error(error);
    }
}

async function pollTaskStatus(taskId) {
    const maxAttempts = 180;
    let attempts = 0;
    let lastTimestamp = 0;

    // Add logs container to the loading spinner
    const loadingSpinner = document.getElementById('loadingSpinner');
    const spinnerContent = loadingSpinner.querySelector('.bg-white');

    // Create logs container if it doesn't exist
    let logsContainer = spinnerContent.querySelector('#progressLogs');
    if (logsContainer) {
        logsContainer.innerHTML = '';
    }
    logsContainer = document.createElement('div');
    logsContainer.id = 'progressLogs';
    logsContainer.className = 'mt-4 max-h-48 overflow-y-auto w-full';
    spinnerContent.appendChild(logsContainer);


    const poll = async () => {
        attempts++;

        try {
            const url = `${baseUrl}/api/task/${taskId}${lastTimestamp > 0 ? `?timestamp=${lastTimestamp}` : ''}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': 'true'
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch task status');
            }

            const result = await response.json();
            console.log(new Date().toLocaleString(), 'Task status:', result.status);

            // Display new logs
            if (result.logs && result.logs.length > 0) {
                result.logs.forEach(log => {
                    const logEntry = document.createElement('p');
                    logEntry.className = 'text-sm text-gray-600 py-1 border-b border-gray-100';
                    logEntry.textContent = `${new Date(log.timestamp).toLocaleString()} => ${log.message}`;
                    logsContainer.appendChild(logEntry);

                    // Update last timestamp
                    if (log.timestamp > lastTimestamp) {
                        lastTimestamp = log.timestamp;
                    }
                });

                // Auto-scroll to bottom
                logsContainer.scrollTop = logsContainer.scrollHeight;
            }

            if (result.status === 'completed') {
                // Task completed, show results
                loadingSpinner.classList.add('hidden');
                //formContainer.classList.add('hidden');
                document.getElementById('progressBar').classList.add('hidden');
                resultsContainer.classList.remove('hidden');
                displayResults(result.data);
                return;
            } else if (result.status === 'failed') {
                // Task failed
                loadingSpinner.classList.add('hidden');
                alert('Failed to plan vacation: ' + (result.error || 'Unknown error'));
                return;
            } else if (result.status === 'pending' || result.status === 'processing') {
                // Still processing, poll again
                if (attempts < maxAttempts) {
                    setTimeout(poll, 5000);
                } else {
                    loadingSpinner.classList.add('hidden');

                    // cancel the task on the server
                    fetch(`${baseUrl}/api/task/${taskId}/cancel`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'ngrok-skip-browser-warning': 'true'
                        }
                    });
                    alert('Request timed out. Please try again later.');

                }
            } else if (result.status === 'cancelled') {
                loadingSpinner.classList.add('hidden');
                alert('The vacation planning task was cancelled.');
                return;
            }
        } catch (error) {
            console.error('Error polling task:', error);

            if (attempts < maxAttempts) {
                setTimeout(poll, 5000);
            } else {
                loadingSpinner.classList.add('hidden');

                // cancel the task on the server
                fetch(`${baseUrl}/api/task/${taskId}/cancel`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'ngrok-skip-browser-warning': 'true'
                    }
                });
                alert('Failed to get results. Please try again.');
            }
        }
    };

    // Start polling
    poll();
}

function displayResults(response) {
    const resultsContent = document.getElementById('resultsContent');

    let html = '<h2 class="text-3xl font-bold text-gray-900 mb-6">Your Vacation Options</h2>';

    response.destinations.forEach((dest, index) => {
        html += `
                    <div class="mb-8 p-6 border border-gray-200 rounded-lg ${index > 0 ? 'mt-6' : ''}">
                        <div class="flex justify-between items-start mb-4">
                            <div>
                                <h3 class="text-2xl font-bold text-gray-900">${dest.name}</h3>
                                <span class="inline-block mt-2 px-3 py-1 bg-green-100 text-green-800 text-sm font-medium rounded-full">
                                    ${dest.visaStatus.replace(/-/g, ' ').toUpperCase()}
                                </span>
                            </div>
                            <div class="text-right">
                                <p class="text-sm text-gray-600">Estimated Total</p>
                                <p class="text-3xl font-bold text-blue-600">$${parseFloat(dest.estimatedCost.total).toFixed(2)}</p>
                            </div>
                        </div>

                        <div class="grid md:grid-cols-2 gap-6 mt-6">
                            <div>
                                <h4 class="font-semibold text-gray-900 mb-2">Visa Information</h4>
                                <p class="text-sm text-gray-600 mb-1">Processing: ${dest.visaProcessingTime}</p>
                                <p class="text-sm text-gray-700 font-medium mb-2">Requirements:</p>
                                <ul class="text-sm text-gray-600 list-disc list-inside space-y-1">
                                    ${dest.visaRequirements.map(req => `<li>${req}</li>`).join('')}
                                </ul>
                            </div>

                            <div>
                                <h4 class="font-semibold text-gray-900 mb-2">Flight Details</h4>
                                <p class="text-sm text-gray-600">Airline: ${dest.flightDetails.airline}</p>
                                <p class="text-sm text-gray-600">Duration: ${dest.flightDetails.duration}</p>
                                <p class="text-sm text-gray-600">Layovers: ${dest.flightDetails.layovers}</p>
                                <p class="text-sm text-gray-700 mt-2">Estimated: <span class="font-semibold">$${parseFloat(dest.estimatedCost.flights).toFixed(2)}</span></p>
                            </div>

                            <div>
                                <h4 class="font-semibold text-gray-900 mb-2">Accommodation</h4>
                                <p class="text-sm text-gray-600 mb-1">${dest.accommodationSuggestion}</p>
                                <p class="text-sm text-gray-700">Estimated: <span class="font-semibold">$${parseFloat(dest.estimatedCost.accommodation).toFixed(2)}</span></p>
                            </div>

                            <div>
                                <h4 class="font-semibold text-gray-900 mb-2">Top Activities</h4>
                                <ul class="text-sm text-gray-600 list-disc list-inside space-y-1">
                                    ${dest.topActivities.slice(0, 4).map(activity => {
            const activityName = activity.name || activity;
            const activityPrice = activity.price || '';
            return `<li><a href="${activity.url}" target="_blank">${activityName}${activityPrice ? ' - ' + activityPrice : ''}</a></li>`;
        }).join('')}
                                </ul>
                                <p class="text-sm text-gray-700 mt-2">Estimated: <span class="font-semibold">$${parseFloat(dest.estimatedCost.activities).toFixed(2)}</span></p>
                            </div>
                        </div>

                        <div class="mt-6 pt-6 border-t border-gray-200">
                            <h4 class="font-semibold text-gray-900 mb-3">Timeline</h4>
                            <div class="space-y-2 text-sm text-gray-600">
                                <p><span class="font-medium text-gray-700">Visa:</span> ${dest.timeline.visaApplication}</p>
                                <p><span class="font-medium text-gray-700">Booking Deadline:</span> ${dest.timeline.bookingDeadline}</p>
                                <p><span class="font-medium text-gray-700">Departure:</span> ${dest.timeline.departureDate}</p>
                            </div>
                        </div>

                        <div class="mt-6 flex gap-3">
                            <a href="${dest.flightDetails.url || 'https://www.google.com/flights'}" target="_blank" 
                                class="flex-1 px-4 py-2 bg-blue-600 text-white text-center rounded-md hover:bg-blue-700 transition-colors">
                                Book Flights
                            </a>
                            <a href="${dest.flightDetails.url || 'https://www.booking.com'}" target="_blank"
                                class="flex-1 px-4 py-2 bg-blue-600 text-white text-center rounded-md hover:bg-blue-700 transition-colors">
                                Book Hotel
                            </a>
                            <a href="https://www.getyourguide.com" target="_blank"
                                class="flex-1 px-4 py-2 bg-blue-600 text-white text-center rounded-md hover:bg-blue-700 transition-colors">
                                Book Activities
                            </a>
                        </div>
                    </div>
                `;
    });

    resultsContent.innerHTML = html;
}

// Event Listeners
prevBtn.addEventListener('click', () => {
    if (currentStep > 1) {
        showStep(currentStep - 1);
    }
});

nextBtn.addEventListener('click', () => {
    if (validateCurrentStep()) {
        if (currentStep < totalSteps) {
            showStep(currentStep + 1);
        }
    }
});

form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (validateCurrentStep()) {
        submitForm();
    }
});

newSearchBtn.addEventListener('click', () => {
    // Reset form
    form.reset();
    currentStep = 1;
    formContainer.classList.remove('hidden');
    document.getElementById('progressBar').classList.remove('hidden');
    resultsContainer.classList.add('hidden');
    showStep(1);
});

// Add CSS for form steps
const style = document.createElement('style');
style.textContent = `
            .form-step {
                display: none;
            }
            .form-step.active {
                display: block;
            }
        `;
document.head.appendChild(style);

// Initialize
updateProgress();

document.addEventListener('DOMContentLoaded', () => {
    // populate country selects
    fetch(`${baseUrl}/api/airports`)
        .then((res) => res.json())
        .then((countries) => {
            const countrySelect = document.getElementById('departureCountry');
            countries.forEach(country => {
                const option = document.createElement('option');
                option.value = country.iata;
                option.textContent = `${country.airport} (${country.region_name})`;
                countrySelect.appendChild(option);
            });
            enhanceDestinationSelect();
        });

});

function enhanceDestinationSelect() {
    const select = document.getElementById('departureCountry');
    const wrapper = document.getElementById('departureCountryWrapper');

    // Create the searchable input
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search or select a country...';
    input.className = 'w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500';

    // Create dropdown list
    const dropdown = document.createElement('ul');
    dropdown.className = 'absolute z-10 bg-white border border-gray-300 rounded-md mt-1 w-full max-h-60 overflow-y-auto hidden shadow-lg';

    // Populate dropdown from select options
    Array.from(select.options).forEach(opt => {
        const li = document.createElement('li');
        li.textContent = opt.textContent;
        li.dataset.value = opt.value;
        li.className = 'px-4 py-2 hover:bg-blue-50 cursor-pointer text-gray-700';
        dropdown.appendChild(li);
    });

    // Add to DOM
    wrapper.appendChild(input);
    wrapper.appendChild(dropdown);

    // Show/hide dropdown
    input.addEventListener('focus', () => dropdown.classList.remove('hidden'));
    input.addEventListener('blur', () => {
        setTimeout(() => dropdown.classList.add('hidden'), 100); // small delay for click
    });

    // Filter options as user types
    input.addEventListener('input', e => {
        const query = e.target.value.toLowerCase();
        Array.from(dropdown.children).forEach(li => {
            li.style.display = li.textContent.toLowerCase().includes(query) ? '' : 'none';
        });
    });

    // Handle selection
    dropdown.addEventListener('click', e => {
        if (e.target.tagName === 'LI') {
            const selected = e.target;
            input.value = selected.textContent;
            select.value = selected.dataset.value;
            dropdown.classList.add('hidden');
        }
    });
};

