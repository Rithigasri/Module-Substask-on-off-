import { fetch } from '@forge/api';

// --- Global Configuration ---


// --- Custom Field Keys ---
const CUSTOM_FIELDS = {
  startDate: "customfield_10054",
  jobTitle: "customfield_10057",
  region: "customfield_10089",
  office: "customfield_10090",
  employeeType: "customfield_10133",
  department: "customfield_10131",
  role: "customfield_10129",
  manager: "customfield_10134",
  equipmentNeeded: "customfield_10130",
  email: "customfield_10404" // <-- Added Email field 
};
// --- Helper: HTTP Headers ---
function getHeaders() {
  const authHeader = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString("base64");
  return {
    "Authorization": `Basic ${authHeader}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
}

// --- Fetch Object Schema ID by Name ---
async function fetchObjectSchemaIdByName(schemaName) {
  const response = await fetch(OBJECTSCHEMA_LIST_URL, { headers: getHeaders() });
  const data = await response.json();
  const schemas = data.values || data;
  const schema = schemas.find(s => s.name === schemaName);
  return schema ? schema.id : null;
}

// --- Fetch Attribute Name:Id Dictionary ---
async function fetchAttributesDict(schemaId) {
  const url = ATTRIBUTES_URL(schemaId);
  const response = await fetch(url, { headers: getHeaders() });
  const data = await response.json();
  let attributes = [];
  if (Array.isArray(data)) {
    attributes = data;
  } else if (Array.isArray(data.values)) {
    attributes = data.values;
  }
  const attrDict = {};
  for (const attr of attributes) {
    attrDict[attr.name] = attr.id;
  }
  return attrDict;
}

// --- Fetch ObjectTypeId for "People" ---
async function fetchPeopleObjectTypeId(schemaId) {
  const url = OBJECTTYPES_URL(schemaId);
  const response = await fetch(url, { headers: getHeaders() });
  const data = await response.json();
  let objectTypes = [];
  if (Array.isArray(data)) {
    objectTypes = data;
  } else if (Array.isArray(data.values)) {
    objectTypes = data.values;
  }
  const peopleType = objectTypes.find(o => o.name === "People");
  return peopleType ? peopleType.id : null;
}

const PEOPLE_OBJECT_TYPE_ID = 36; // Use this fixed objectTypeId for People

// --- Map Response to Attribute Format ---
function mapResponseToAttributes(responseObj, attrDict) {
  const attributes = [];
  for (const [name, value] of Object.entries(responseObj)) {
    if (attrDict[name]) {
      attributes.push({
        objectTypeAttributeId: attrDict[name],
        objectAttributeValues: [{ value }]
      });
    }
  }
  return attributes;
}

// --- Create People Object ---
async function createPeopleObject(attributes) {
  const payload = {
    objectTypeId: PEOPLE_OBJECT_TYPE_ID,
    attributes: attributes
  };
  const response = await fetch(CREATE_OBJECT_URL, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    console.error("Failed to create People object:", response.status, await response.text());
    return null;
  }
  const data = await response.json();
  console.log("People object created:", data);
  return data;
}

// Helper: Fetch attribute name:id dictionary for objectTypeId 36 (People)
async function fetchPeopleAttributeDict() {
  const url = `${API_BASE_URL}objecttype/36/attributes`;
  const response = await fetch(url, { headers: getHeaders() });
  const data = await response.json();
  let attributes = [];
  if (Array.isArray(data)) {
    attributes = data;
  } else if (Array.isArray(data.values)) {
    attributes = data.values;
  }
  const attrDict = {};
  for (const attr of attributes) {
    attrDict[attr.name] = attr.id;
  }
  return attrDict;
}

// --- Main Forge Handler: Onboard Employee (was addPeopleAsset) ---
export async function onboardEmployee(payload) {
  console.log("Payload received:", payload);

  const { ticketNumber } = payload;
  if (!ticketNumber) {
    console.error("❌ Invalid payload. Ensure ticketNumber is provided.");
    return {
      status: "error",
      message: "Invalid payload. Ensure ticketNumber is provided.",
    };
  }

  // 1. Fetch attribute dictionary for People objectTypeId 36
  const attrDict = await fetchPeopleAttributeDict();

  // 2. Fetch ticket details
  const ISSUE_URL = `${JIRA_BASE_URL}/rest/api/3/issue/${ticketNumber}`;
  const response = await fetch(ISSUE_URL, { method: "GET", headers: getHeaders() });
  if (!response.ok) {
    return { status: "error", message: `Failed to fetch issue: ${response.status}` };
  }
  const data = await response.json();
  const fields = data.fields;

  // 3. Map ticket fields to People attributes (no Employee Equipment Needed, no Department)
  const mapped = {
    Name: fields.summary || null,
    "Title": fields[CUSTOM_FIELDS.jobTitle] || null,
    "Start Date": fields[CUSTOM_FIELDS.startDate] || null,
    Email: fields[CUSTOM_FIELDS.email] || null,
    Region: (fields[CUSTOM_FIELDS.region]?.[0]?.objectId) || null,
    Office: (fields[CUSTOM_FIELDS.office]?.[0]?.objectId) || null,
    Type: (fields[CUSTOM_FIELDS.employeeType]?.[0]?.objectId) || null,
    "Job Role": (fields[CUSTOM_FIELDS.role]?.[0]?.objectId) || null,
    Manager: (fields[CUSTOM_FIELDS.manager]?.[0]?.objectId) || null
  };

  // 4. Map to attributes array for POST
  const attributes = [];
  for (const [name, value] of Object.entries(mapped)) {
    if (attrDict[name]) {
      attributes.push({
        objectTypeAttributeId: attrDict[name],
        objectAttributeValues: [{ value: value === undefined ? null : value }]
      });
    }
  }

  // Add attribute id 791 ("Status" dropdown) with value "ACTIVE"
  attributes.push({
    objectTypeAttributeId: 791,
    objectAttributeValues: [{ value: "ACTIVE" }]
  });

  // 5. Post as People object using objectTypeId 36
  const payloadData = {
    objectTypeId: 36,
    attributes: attributes
  };
  console.log("Payload being sent to create People object:", JSON.stringify(payloadData, null, 2));
  const createResp = await fetch(CREATE_OBJECT_URL, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payloadData)
  });
  if (!createResp.ok) {
    console.error("Failed to create People object:", createResp.status, await createResp.text());
    return { status: "error", message: "Failed to create People object." };
  }
  const result = await createResp.json();
  console.log("People object created:", result);

  return { status: "success", details: result };
}

// --- Sync to Confluence ---
export async function syncToConfluence() {
  const OBJECT_TYPE_ID = 69; // Laptops objectTypeId
  const CONFLUENCE_PAGE_ID = "10944513";
  const CONFLUENCE_BASE_URL = "https://one-atlas-tfft.atlassian.net//wiki/rest/api";

  // Fetch all laptop objects
  async function getLaptopObjects() {
    const url = `${API_BASE_URL}object/aql?startAt=0&maxResults=10&includeAttributes=true`;
    const payload = {
      qlQuery: `objectTypeId = ${OBJECT_TYPE_ID}`,
    };
    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error("❌ Failed to fetch laptop objects:", response.status, await response.text());
      return [];
    }
    const data = await response.json();
    return data.values || [];
  }

  // Fetch detailed attributes for a laptop object
  async function getObjectDetails(objectId) {
    const url = `${API_BASE_URL}object/${objectId}?includeExtendedInfo=false`;
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) return null;
    const data = await response.json();
    const attributes = {};
    data.attributes.forEach((attr) => {
      const name = attr.objectTypeAttribute.name;
      const value = attr.objectAttributeValues?.[0];
      if (value) {
        if (value.referencedObject) {
          attributes[name] = value.referencedObject.displayValue || value.referencedObject.name;
        } else {
          attributes[name] = value.displayValue || value.value;
        }
      } else {
        attributes[name] = "";
      }
    });
    return { id: data.id, name: data.name, attributes };
  }

  // Get current page version
  async function getConfluencePageVersion(pageId) {
    const url = `${CONFLUENCE_BASE_URL}/content/${pageId}?expand=version`;
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) return null;
    const data = await response.json();
    return data.version.number;
  }

  // Update Confluence page
  async function updateConfluencePage(pageId, title, content, versionNumber) {
    const url = `${CONFLUENCE_BASE_URL}/content/${pageId}`;
    const payload = {
      id: pageId,
      type: "page",
      title: title,
      body: {
        storage: {
          value: `<p><pre>${content}</pre></p>`,
          representation: "storage",
        },
      },
      version: {
        number: versionNumber + 1,
        message: "Updated with the latest Laptop asset data",
      },
    };
    const response = await fetch(url, {
      method: "PUT",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    return response.ok;
  }

  try {
    // Fetch all laptops and their attributes
    const laptops = await getLaptopObjects();
    const detailedLaptops = [];
    for (const laptop of laptops) {
      const details = await getObjectDetails(laptop.id);
      if (details) {
        detailedLaptops.push(details);
      }
    }

    const jsonContent = JSON.stringify(detailedLaptops, null, 2);
    const title = "Laptop Asset Knowledge Base";
    const versionNumber = await getConfluencePageVersion(CONFLUENCE_PAGE_ID);
    if (versionNumber !== null) {
      const ok = await updateConfluencePage(CONFLUENCE_PAGE_ID, title, jsonContent, versionNumber);
      if (ok) {
        return { status: "success", message: "Confluence page updated with Laptop asset data." };
      }
    }
    return { status: "error", message: "Failed to update Confluence page." };
  } catch (error) {
    return { status: "error", message: "Error syncing to Confluence: " + error.message };
  }
}

// --- Query Knowledge Base ---
export async function queryKnowledgeBase(payload) {
  console.log("Received payload for queryKnowledgeBase:", JSON.stringify(payload, null, 2));

  const query = payload?.query;

  if (typeof query !== "string" || query.trim() === "") {
    console.error("❌ Invalid query parameter. Query must be a non-empty string.");
    return {
      status: "error",
      message: "Invalid query. Please provide a valid question or search term.",
    };
  }

  const confluencePageId = "10944513"; // ID of the Confluence page
  const url = `${CONFLUENCE_BASE_URL}/content/${confluencePageId}?expand=body.storage`;

  try {
    console.log("🔄 Fetching content from the Confluence knowledge base...");
    const response = await fetch(url, {
      method: "GET",
      headers: getHeaders(),
    });

    if (!response.ok) {
      console.error("❌ Failed to fetch knowledge base content:", response.status, await response.text());
      return {
        status: "error",
        message: "Failed to fetch knowledge base content.",
      };
    }

    const data = await response.json();
    const rawContent = data.body.storage.value; // HTML content of the page
    console.log("✅ Successfully fetched knowledge base content.");
    console.log("📄 Confluence Content (Raw):", rawContent);

    // Decode HTML entities (e.g., &quot; -> ")
    const decodeHtmlEntities = (str) => {
      return str
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
    };

    const decodedContent = decodeHtmlEntities(rawContent.replace(/<\/?p>/g, "").trim());
    console.log("📄 Confluence Content (Decoded):", decodedContent);

    // Short Gemini prompt for asset answer provider
    const geminiPrompt = `You are an answer provider for assets. 
If an asset's status is "Available", it means the asset is not allocated; otherwise, it is allocated. 
Use the knowledge base content to answer the user's asset-related question accordingly. If the user prompts available asset then provide
the user with assets name`;

    // Prepare the payload for the Gemini API with a refined prompt
    const geminiPayload = {
      contents: [
        {
          parts: [
            {
              text: `${geminiPrompt}

Knowledge Base Content:
${decodedContent}

Question: ${query}`,
            },
          ],
        },
      ],
    };

    console.log("📄 Question passed to Gemini API:", query);
    console.log("📄 Payload sent to Gemini API:", JSON.stringify(geminiPayload, null, 2));

    // Call the Gemini API
    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyBHIphFwRclkJs5BCrxxUut_Vp3dk6PNJ8",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload),
      }
    );

    if (!geminiResponse.ok) {
      console.error(
        "❌ Failed to get response from Gemini API:",
        geminiResponse.status,
        await geminiResponse.text()
      );
      return {
        status: "error",
        message: "Failed to get a response from the Gemini API.",
      };
    }

    const geminiData = await geminiResponse.json();
    const geminiAnswer =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "No response from Gemini.";

    console.log("✅ Successfully received response from Gemini API:", geminiAnswer);

    return {
      status: "success",
      answer: geminiAnswer,
    };
  } catch (error) {
    console.error("❌ Error in queryKnowledgeBase:", error);
    return {
      status: "error",
      message: "An error occurred while querying the knowledge base.",
    };
  }
}

// --- Assign Asset ---
export async function assignAsset(payload) {
  console.log("=== assignAsset called ===");
  console.log("Payload received for assignAsset:", payload);

  const { assetName, email } = payload;

  if (!assetName || !email) {
    console.error("❌ Missing required fields in payload. Ensure both assetName and email are provided.");
    return {
      status: "error",
      message: "Missing required fields. Ensure both assetName and email are provided.",
    };
  }

  // 1. Get the People objectKey by email
  const getEmployeeObjectKeyByEmail = async (email) => {
    console.log(`🔍 Looking up employee by email: ${email}`);
    const url = `${API_BASE_URL}object/aql?startAt=0&maxResults=1&includeAttributes=true`;
    const payload = {
      qlQuery: `objectType = "People" AND Email = "${email}"`,
    };
    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error("❌ Failed to fetch employee by email:", response.status, await response.text());
      return null;
    }
    const data = await response.json();
    console.log("Employee lookup result:", data);
    if (data.total === 1) {
      const objectKey = data.values[0]?.objectKey;
      const name = data.values[0]?.name;
      console.log(`✅ Found employee: ${name} (objectKey: ${objectKey})`);
      return { objectKey, name };
    }
    console.warn("No employee found with that email.");
    return null;
  };

  // 2. Get the Laptop asset by Name (objectType = "Laptops", Name = assetName)
  const getLaptopByName = async (laptopName) => {
    console.log(`🔍 Looking up laptop by name: ${laptopName}`);
    const url = `${API_BASE_URL}object/aql?startAt=0&maxResults=1&includeAttributes=true`;
    const payload = {
      qlQuery: `objectType = "Laptops" AND Name = "${laptopName}"`,
    };
    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error("❌ Failed to fetch laptop by name:", response.status, await response.text());
      return null;
    }
    const data = await response.json();
    console.log("Laptop lookup result:", data);
    if (data.total === 1) {
      const objectKey = data.values[0]?.objectKey;
      const name = data.values[0]?.name;
      const id = data.values[0]?.id;
      console.log(`✅ Found laptop: ${name} (objectKey: ${objectKey}, id: ${id})`);
      return { objectKey, name, id };
    }
    console.warn("No laptop found with that name.");
    return null;
  };

  // 3. Check if "Owner" (attribute id 729) is empty
  const getOwnerAttribute = async (assetId) => {
    console.log(`🔍 Checking Owner attribute (id 729) for asset id: ${assetId}`);
    const url = `${API_BASE_URL}object/${assetId}?includeExtendedInfo=false`;
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) {
      console.error("❌ Failed to fetch asset details:", response.status, await response.text());
      return null;
    }
    const data = await response.json();
    const attr = data.attributes.find(a => a.objectTypeAttributeId == "729");
    if (!attr) {
      console.log(`Owner attribute (id 729) not found for asset ${assetId}`);
      return null;
    }
    const value = attr.objectAttributeValues?.[0]?.referencedObject?.label || attr.objectAttributeValues?.[0]?.value || null;
    console.log(`Current value of Owner attribute for asset ${assetId}:`, value);
    return value;
  };

  // 4. Assign asset if not already assigned
  const assignAssetToEmployee = async (assetId, employeeObjectKey) => {
    console.log(`🔄 Assigning asset id ${assetId} to employee objectKey ${employeeObjectKey}`);
    const url = `${API_BASE_URL}object/${assetId}`;
    const payload = {
      attributes: [
        {
          objectTypeAttributeId: "729", // "Owner"
          objectAttributeValues: [{ value: employeeObjectKey }],
        },
        {
          objectTypeAttributeId: "954", // Status (dropdown for Laptops)
          objectAttributeValues: [{ value: "ASSIGNED" }],
        },
      ],
    };
    const response = await fetch(url, {
      method: "PUT",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error("❌ Failed to assign asset:", response.status, await response.text());
      return false;
    }
    console.log("✅ Asset assignment successful and status set to ASSIGNED.");
    return true;
  };

  // --- Main Logic ---
  const employee = await getEmployeeObjectKeyByEmail(email);
  if (!employee) {
    console.warn(`No employee found with email: ${email}`);
    return {
      status: "error",
      message: `No employee found with email: ${email}. Please add them as an employee before assigning an asset.`,
    };
  }

  const laptop = await getLaptopByName(assetName);
  if (!laptop) {
    return {
      status: "error",
      message: `No laptop found with Name: ${assetName}`,
    };
  }

  const owner = await getOwnerAttribute(laptop.id);
  console.log(`Current "Owner" value for laptop:`, owner);

  if (owner) {
    console.log(`Laptop is already assigned to: ${owner}`);
    return {
      status: "info",
      message: `Laptop is already assigned to: ${owner}`,
    };
  }

  const success = await assignAssetToEmployee(laptop.id, employee.objectKey);
  if (success) {
    return {
      status: "success",
      message: `Laptop assigned to ${employee.name} (${email}) and status set to ASSIGNED.`,
    };
  } else {
    console.error("Failed to assign laptop.");
    return {
      status: "error",
      message: "Failed to assign laptop.",
    };
  }
}

// --- Offboard Employee ---
export async function offboardEmployee(payload) {
  console.log("=== offboardEmployee called ===");
  console.log("Payload received for offboardEmployee:", payload);

  const { ticketNumber } = payload;
  if (!ticketNumber) {
    console.error("❌ Invalid payload. Ensure ticketNumber is provided.");
    return {
      status: "error",
      message: "Invalid payload. Ensure ticketNumber is provided.",
    };
  }

  // 1. Fetch ticket details
  const ISSUE_URL = `${JIRA_BASE_URL}/rest/api/3/issue/${ticketNumber}`;
  const response = await fetch(ISSUE_URL, { method: "GET", headers: getHeaders() });
  if (!response.ok) {
    return { status: "error", message: `Failed to fetch issue: ${response.status}` };
  }
  const data = await response.json();
  const fields = data.fields;

  // 2. Get the employee objectId from customfield_10137
  const empArr = fields["customfield_10137"];
  let employeeObjectId = null;
  if (Array.isArray(empArr) && empArr.length > 0 && empArr[0].objectId) {
    employeeObjectId = empArr[0].objectId;
  }
  if (!employeeObjectId) {
    console.error("❌ Employee objectId not found in ticket.");
    return {
      status: "error",
      message: "Employee objectId not found in ticket.",
    };
  }
  console.log(`✅ Employee objectId from ticket: ${employeeObjectId}`);

  // 3. Set employee status to "DEACTIVATED"
  const updateEmployeeUrl = `${API_BASE_URL}object/${employeeObjectId}`;
  const statusPayload = {
    attributes: [
      {
        objectTypeAttributeId: "791", // Status dropdown attribute for People
        objectAttributeValues: [{ value: "DEACTIVATED" }],
      },
    ],
  };
  const updateStatusResp = await fetch(updateEmployeeUrl, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(statusPayload),
  });
  if (!updateStatusResp.ok) {
    console.error("❌ Failed to update employee status:", updateStatusResp.status, await updateStatusResp.text());
    return {
      status: "error",
      message: "Failed to update employee status.",
    };
  }
  console.log("✅ Employee status set to DEACTIVATED.");

  // 4. Find all laptops where Owner (729) = this employee
  const laptopAqlUrl = `${API_BASE_URL}object/aql?startAt=0&maxResults=100&includeAttributes=true`;
  const laptopAqlPayload = {
    qlQuery: `objectType = "Laptops" AND Owner = ${employeeObjectId}`,
  };
  const laptopResp = await fetch(laptopAqlUrl, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(laptopAqlPayload),
  });
  if (!laptopResp.ok) {
    console.error("❌ Failed to fetch laptops for employee:", laptopResp.status, await laptopResp.text());
    return {
      status: "error",
      message: "Failed to fetch laptops for employee.",
    };
  }
  const laptopData = await laptopResp.json();
  const laptops = laptopData.values || [];
  console.log(`Found ${laptops.length} laptops assigned to employee.`);

  // 5. For each laptop, remove Owner and set status to "AVAILABLE"
  for (const laptop of laptops) {
    const laptopId = laptop.id;
    // Remove Owner and set status to AVAILABLE (attribute id 954)
    const removeOwnerPayload = {
      attributes: [
        {
          objectTypeAttributeId: "729", // Owner
          objectAttributeValues: [], // Remove owner
        },
        {
          objectTypeAttributeId: "954", // Status (dropdown for Laptops)
          objectAttributeValues: [{ value: "AVAILABLE" }],
        },
      ],
    };
    const updateLaptopUrl = `${API_BASE_URL}object/${laptopId}`;
    const updateLaptopResp = await fetch(updateLaptopUrl, {
      method: "PUT",
      headers: getHeaders(),
      body: JSON.stringify(removeOwnerPayload),
    });
    if (updateLaptopResp.ok) {
      console.log(`✅ Laptop ${laptop.name} owner removed and status set to AVAILABLE.`);
    } else {
      console.error(`❌ Failed to update laptop ${laptop.name}:`, updateLaptopResp.status, await updateLaptopResp.text());
    }
  }

  return {
    status: "success",
    message: `Employee offboarded: status set to DEACTIVATED and all assigned laptops deallocated and set to AVAILABLE.`,
  };
}

/**
 * Create onboarding subtasks for a Jira ticket.
 * @param {Object} payload - { ticketNumber: string }
 */
export async function createSubtasks(payload) {
  const { ticketNumber } = payload;
  if (!ticketNumber) {
    return { status: "error", message: "ticketNumber is required" };
  }

  // 1. Fetch parent issue details
  const ISSUE_URL = `${JIRA_BASE_URL}/rest/api/3/issue/${ticketNumber}`;
  const parentResp = await fetch(ISSUE_URL, { method: "GET", headers: getHeaders() });
  if (!parentResp.ok) {
    return { status: "error", message: `Failed to fetch parent issue: ${parentResp.status}` };
  }
  const parentData = await parentResp.json();
  const empName = parentData.fields.summary || "Employee";
  const projectKey = parentData.fields.project.key;
  const empEmail = parentData.fields?.customfield_10404 || "";

  // 2. Prepare subtask payloads with descriptions (ADF format)
  function toADF(text) {
    return {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: text
            }
          ]
        }
      ]
    };
  }

  const subtasks = [
    {
      summary: `Email ID creation for ${empName}`,
      description: toADF("Create an email ID for the employee.")
    },
    {
      summary: `Active Directory Account creation for ${empName}`,
      description: toADF("Create an account in Active Directory for the employee.")
    },
    {
      summary: `Sending Loom Video through mail`,
      description: toADF(`Name of employee: ${empName}\nEmail ID: ${empEmail}\nLoom video link: https://www.loom.com/`)
    }
  ];

  const createdSubtasks = [];
  for (const { summary, description } of subtasks) {
    const subtaskPayload = {
      fields: {
        project: { key: projectKey },
        parent: { key: ticketNumber },
        summary,
        description,
        issuetype: { name: "Sub-task" },
      },
    };
    const createResp = await fetch(`${JIRA_BASE_URL}/rest/api/3/issue`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(subtaskPayload),
    });
    if (!createResp.ok) {
      return { status: "error", message: `Failed to create subtask: ${await createResp.text()}` };
    }
    const subtaskData = await createResp.json();
    createdSubtasks.push(subtaskData.key);
  }

  return {
    status: "success",
    message: "Subtasks created.",
    subtasks: createdSubtasks,
  };
}