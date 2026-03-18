// deploy.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);

if (args.length < 5) {
  console.error("Usage: node deploy.js <API_URL> <API_KEY> <PROJECT_NAME> <APP_NAME> <GITHUB_TOKEN> [DOMAIN]");
  process.exit(1);
}

const [apiUrl, apiKey, projectName, appName, githubToken, domain] = args;
const baseUrl = apiUrl.endsWith('/api') ? apiUrl : `${apiUrl}/api`;

async function fetchDokploy(endpoint, method = 'GET', body = null) {
  const url = `${baseUrl}${endpoint}`;
  const options = {
    method,
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);
  
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch(e) {
    data = text;
  }

  if (!res.ok) {
    throw new Error(`Dokploy API Error ${res.status}: ${typeof data === 'object' ? JSON.stringify(data) : data}`);
  }
  return data;
}

async function fetchGitHub(endpoint, method = 'GET', body = null) {
  const url = `https://api.github.com${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'SICoder-Auto-Deploy-Skill'
    }
  };
  if (body) {
      options.body = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
  }
  
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch(e) {
    data = text;
  }

  if (!res.ok) {
    throw new Error(`GitHub API Error ${res.status}: ${typeof data === 'object' ? JSON.stringify(data) : data}`);
  }
  return data;
}

const delay = ms => new Promise(res => setTimeout(res, ms));

const dns = require('dns');
const util = require('util');
const lookup = util.promisify(dns.lookup);

async function configureHostingerDNS(fullDomain, apiUrl) {
  const hostingerToken = process.env.HOSTINGER_API_TOKEN;
  if (!hostingerToken || !fullDomain) return;

  try {
    console.log(`\n🌍 Checking Hostinger DNS for ${fullDomain}...`);
    // Determine the IP address of the Dokploy server
    const apiHost = new URL(apiUrl).hostname;
    const { address: serverIp } = await lookup(apiHost);

    // Fetch user domains
    const portfolioRes = await fetch("https://developers.hostinger.com/api/domains/v1/portfolio", {
      headers: { 'Authorization': `Bearer ${hostingerToken}`, 'Accept': 'application/json' }
    });
    if(!portfolioRes.ok) return;
    const domains = await portfolioRes.json();

    // Find matching root domain
    let rootDomain = null;
    let subdomain = "@";
    for (const d of domains) {
      if (fullDomain === d.domain) {
        rootDomain = d.domain;
        subdomain = "@";
        break;
      } else if (fullDomain.endsWith(`.${d.domain}`)) {
        rootDomain = d.domain;
        subdomain = fullDomain.replace(`.${d.domain}`, '');
        break;
      }
    }

    if (!rootDomain) {
      console.log(`⚠️ Root domain for ${fullDomain} not found in Hostinger account. Skipping DNS automation.`);
      return;
    }

    // Fetch zone
    const zoneRes = await fetch(`https://developers.hostinger.com/api/dns/v1/zones/${rootDomain}`, {
      headers: { 'Authorization': `Bearer ${hostingerToken}`, 'Accept': 'application/json' }
    });
    if(!zoneRes.ok) return;
    const zoneRecords = await zoneRes.json();
    if(!Array.isArray(zoneRecords)) return;

    // Check if A record exists
    const exists = zoneRecords.some(r => r.name === subdomain && r.type === 'A');
    if (!exists) {
      console.log(`📝 Adding A record for '${subdomain}' -> ${serverIp} in zone ${rootDomain}...`);
      zoneRecords.push({
        name: subdomain,
        type: 'A',
        ttl: 14400,
        records: [{ content: serverIp, is_disabled: false }]
      });

      const putRes = await fetch(`https://developers.hostinger.com/api/dns/v1/zones/${rootDomain}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${hostingerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone: zoneRecords })
      });

      if (putRes.ok) {
        console.log(`✅ Hostinger DNS updated successfully for ${fullDomain}.`);
        // Wait a few seconds for propagation if possible
        await new Promise(res => setTimeout(res, 5000));
      } else {
        console.warn(`⚠️ Failed to update Hostinger DNS: ${await putRes.text()}`);
      }
    } else {
      console.log(`✅ A record for ${fullDomain} already exists in Hostinger.`);
    }
  } catch(e) {
    console.warn(`⚠️ Hostinger DNS configuration skipped due to error: ${e.message}`);
  }
}

async function run() {
  try {
    console.log(`🚀 Starting full-stack zero-human deployment for ${appName} in project ${projectName}`);
    
    // --- 1. GITHUB REPOSITORY CREATION & PUSH ---
    console.log("🐙 Checking/Creating GitHub Repository...");
    const user = await fetchGitHub('/user');
    const githubUsername = user.login;
    let repoUrl = `git@github.com:${githubUsername}/${appName}.git`;
    
    try {
        await fetchGitHub(`/repos/${githubUsername}/${appName}`);
        console.log(`✅ GitHub repository ${githubUsername}/${appName} already exists.`);
    } catch(e) {
        if(e.message.includes('404')) {
            console.log(`📁 Creating new private GitHub repository: ${appName}...`);
            await fetchGitHub('/user/repos', 'POST', {
                name: appName,
                private: true,
                description: `Auto-generated repository for ${appName}`
            });
            console.log(`✅ GitHub repository created successfully.`);
        } else {
            throw e;
        }
    }

    console.log("💻 Pushing local code to GitHub via SSH...");
    try {
        // Clear local build cache to avoid stale URLs
        if (fs.existsSync(path.join(process.cwd(), '.next'))) {
            console.log("🧹 Clearing local .next build cache...");
            execSync('rm -rf .next');
        }

        execSync(`git config --global init.defaultBranch main`);
        try { execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' }); } catch {
            execSync('git init');
        }
        
        try { execSync('git remote remove origin', { stdio: 'ignore' }); } catch(e) {}
        execSync(`git remote add origin ${repoUrl}`);
        
        execSync('git add .');
        try { execSync('git commit -m "Auto-deploy commit"', { stdio: 'ignore' }); } catch(e) {}
        
        const branchBuffer = execSync('git branch --show-current');
        let currentBranch = branchBuffer.toString().trim();
        if(!currentBranch) currentBranch = 'main';
        
        execSync(`git push -u origin ${currentBranch} --force`, { stdio: 'ignore' });
        console.log(`✅ Code pushed to ${repoUrl} on branch ${currentBranch}.`);
        
    } catch(error) {
        console.error("❌ Git push failed. Ensure your local SSH keys are configured for GitHub.");
        throw error;
    }

    const branch = execSync('git branch --show-current').toString().trim() || 'main';


    // --- 2. DOKPLOY PROJECT CREATION (API Specs: ${baseUrl}/swagger) ---
    console.log("🔍 Fetching Dokploy projects...");
    const projects = await fetchDokploy('/project.all');
    let project = projects.find(p => p.name === projectName);
    
    if (!project) {
      console.log(`📁 Project '${projectName}' not found on Dokploy. Creating...`);
      await fetchDokploy('/project.create', 'POST', { name: projectName });
      const updatedProjects = await fetchDokploy('/project.all');
      project = updatedProjects.find(p => p.name === projectName);
      if (!project) throw new Error("Failed to retrieve created Dokploy project.");
    }

    const environment = project.environments?.[0];
    const envId = environment?.environmentId;
    if (!envId) {
      throw new Error(`No environments found for project ${projectName}`);
    }
    const secureGitUrl = `https://${githubUsername}:${githubToken}@github.com/${githubUsername}/${appName}.git`;

    const hasDockerCompose = fs.existsSync(path.join(process.cwd(), 'docker-compose.yml'));
    const hasDockerfile = fs.existsSync(path.join(process.cwd(), 'Dockerfile'));

    // --- 3. DOKPLOY COMPOSE DEPLOYMENT (For Self-Hosted DB) ---
    if (hasDockerCompose) {
      const composeAppName = `${appName}-db`;
      console.log(`\n🐳 Docker Compose found. Setting up DB using Convex template: ${composeAppName}`);
      
      let composeApp = project.environments[0]?.compose?.find(c => c.name === composeAppName);
      
      if (!composeApp) {
        console.log(`📦 Compose App '${composeAppName}' not found. Deploying from Convex template...`);
        try {
            const deployTplRes = await fetchDokploy('/compose.deployTemplate', 'POST', {
              environmentId: envId,
              id: "convex"
            });
            
            if (deployTplRes && deployTplRes.composeId) {
                await fetchDokploy('/compose.update', 'POST', {
                    composeId: deployTplRes.composeId,
                    name: composeAppName
                });
                const updatedProjects2 = await fetchDokploy('/project.all');
                const p2 = updatedProjects2.find(p => p.name === projectName);
                composeApp = p2.environments[0]?.compose?.find(c => c.name === composeAppName);
            }
        } catch(e) {
            console.error("Failed to deploy Convex template.", e.message);
        }
      } else {
        console.log(`📦 Compose App '${composeAppName}' already exists (ID: ${composeApp.composeId}).`);
      }

      if (composeApp) {
          if (domain) {
              const apiDomain = `api-${domain}`;
              const dashDomain = `dash-${domain}`;
              const siteDomain = `site-${domain}`;
              
              console.log(`\n🌐 Setting up backend domains: ${apiDomain}, ${dashDomain}, ${siteDomain}`);
              
              // 1. Hostinger DNS
              await configureHostingerDNS(apiDomain, apiUrl);
              await configureHostingerDNS(dashDomain, apiUrl);
              await configureHostingerDNS(siteDomain, apiUrl);

              // 2. Create Dokploy Domains
              try {
                  await fetchDokploy('/domain.create', 'POST', {
                    composeId: composeApp.composeId, host: apiDomain, port: 3210, serviceName: "backend", https: true, certificateType: "letsencrypt"
                  });
                  await fetchDokploy('/domain.create', 'POST', {
                    composeId: composeApp.composeId, host: siteDomain, port: 3211, serviceName: "backend", https: true, certificateType: "letsencrypt"
                  });
                  await fetchDokploy('/domain.create', 'POST', {
                    composeId: composeApp.composeId, host: dashDomain, port: 6791, serviceName: "dashboard", https: true, certificateType: "letsencrypt"
                  });

                  // 3. Update Compose Environment Variables
                  const crypto = require('crypto');
                  const instanceSecret = crypto.randomBytes(32).toString('hex');
                  const env = `NEXT_PUBLIC_DEPLOYMENT_URL=https://${apiDomain}\nCONVEX_CLOUD_ORIGIN=https://${apiDomain}\nCONVEX_SITE_ORIGIN=https://${siteDomain}\nINSTANCE_SECRET=${instanceSecret}\nINSTANCE_NAME=${appName}`;
                  
                  await fetchDokploy('/compose.update', 'POST', {
                    composeId: composeApp.composeId,
                    env
                  });
                  console.log(`✅ Backend domains configured successfully in Dokploy.`);
                  console.log(`\n🔑 IMPORTANT: To deploy your Convex schema, SSH into your Dokploy server and run:`);
                  console.log(`docker exec <your_compose_project>-backend-1 ./generate_admin_key.sh`);
                  console.log(`Then run locally: npx convex deploy --url https://${apiDomain} --admin-key "<the_generated_key>"\n`);
              } catch (e) {
                  console.warn(`⚠️ Warning setting up backend domains: ${e.message}`);
              }
          }

          console.log("🚀 Triggering Compose deployment...");
          await fetchDokploy('/compose.deploy', 'POST', { composeId: composeApp.composeId });
          console.log(`⏳ Compose deployment started.`);

          // --- STEP 3: AUTOMATIC SCHEMA DEPLOYMENT ---
          if (fs.existsSync(path.join(process.cwd(), 'convex/schema.ts'))) {
              console.log("🔑 Convex detected. Waiting for backend to be healthy for schema deployment...");
              await delay(15000); // Wait for startup
              
              try {
                  const containerName = `${composeApp.appName}-backend-1`;
                  const { execSync } = require('child_process');
                  const adminKey = execSync(`sudo docker exec ${containerName} ./generate_admin_key.sh | grep -v "Admin key:"`, { stdio: 'pipe' }).toString().trim();
                  
                  if (adminKey) {
                      console.log("📤 Pushing Convex schema automatically...");
                      execSync(`NODE_TLS_REJECT_UNAUTHORIZED=0 npx convex deploy --url https://${apiDomain} --admin-key "${adminKey}"`, { stdio: 'inherit' });
                      console.log("✅ Convex schema deployed successfully.");
                      
                      // Save Admin Key to the COMPOSE service env as well
                      console.log("💾 Saving Admin Key to Dokploy Compose environment...");
                      try {
                          // Fetch latest compose data to ensure we have the ID and current env
                          const updatedProjectsForEnv = await fetchDokploy('/project.all');
                          const pEnv = updatedProjectsForEnv.find(p => p.name === projectName);
                          const cApp = pEnv.environments[0]?.compose?.find(c => c.name === composeAppName);
                          
                          if (cApp) {
                              const currentCompose = await fetchDokploy(`/compose.one?composeId=${cApp.composeId}`);
                              const updatedEnv = `${currentCompose.env}\nCONVEX_ADMIN_KEY=${adminKey}`;
                              await fetchDokploy('/compose.update', 'POST', {
                                  composeId: cApp.composeId,
                                  env: updatedEnv
                              });
                              console.log("✅ Admin Key saved to Compose env.");
                          }
                      } catch (e) {
                          console.warn("⚠️ Failed to save admin key to compose env:", e.message);
                      }

                      // Store for later use in application.update
                      project.tempAdminKey = adminKey;
                      console.log(`\n🔑 CONVEX_ADMIN_KEY generated: ${adminKey}`);
                  }
              } catch (err) {
                  console.warn("⚠️ Automatic schema deployment failed. You may need to run it manually later.");
              }
          }
      }
    }

    // --- 4. DOKPLOY APPLICATION DEPLOYMENT (For Frontend) ---
    if (hasDockerfile) {
      console.log(`\n📄 Dockerfile found. Setting up standard Application: ${appName}`);
      let app = project.environments[0]?.applications?.find(a => a.name === appName);
      
      if (!app) {
        console.log(`📦 Application '${appName}' not found. Creating...`);
        try {
            await fetchDokploy('/application.create', 'POST', {
              name: appName,
              appName: appName, 
              environmentId: envId
            });
            // Fetch again to get the ID
            const updatedProjects3 = await fetchDokploy('/project.all');
            const p3 = updatedProjects3.find(p => p.name === projectName);
            app = p3.environments[0]?.applications?.find(a => a.name === appName);
        } catch(e) {
             console.error("Failed to create application.", e.message);
        }
      } else {
         console.log(`📦 Application '${appName}' already exists (ID: ${app.applicationId}). Updating...`);
      }

          if (app) {
          const appId = app.applicationId;
          
          console.log(`⚙️ Configuring Dokploy application source as raw Git...`);
          try {
            // Set environment variables for the frontend (Next.js build)
            let appEnv = "";
            if (domain) {
                const apiDomain = `api-${domain}`;
                appEnv = `NEXT_PUBLIC_CONVEX_URL=https://${apiDomain}`;
                if (project.tempAdminKey) {
                    appEnv += `\nCONVEX_ADMIN_KEY=${project.tempAdminKey}`;
                }
            }

            await fetchDokploy('/application.update', 'POST', {
              applicationId: appId,
              customGitUrl: secureGitUrl,
              customGitBranch: branch,
              buildType: "dockerfile",
              dockerfile: "Dockerfile",
              sourceType: "git",
              env: appEnv,
              buildArgs: appEnv
            });
            console.log(`✅ Dokploy application updated successfully.`);
          } catch(e) {
            console.warn(`⚠️ Warning during application update: ${e.message}`);
          }

          if (domain) {
              console.log(`🌐 Setting up domain ${domain}...`);
              // FIRST: Check and configure Hostinger DNS
              await configureHostingerDNS(domain, apiUrl);

              try {
                  await fetchDokploy('/domain.create', 'POST', {
                      applicationId: appId,
                      host: domain,
                      https: true,
                      certificateType: "letsencrypt"
                  });
                  console.log(`✅ Domain ${domain} created.`);
              } catch(e) {
                  // Usually fails if domain exists or is assigned to another app. It's safe to ignore.
                  console.warn(`⚠️ Note on domain creation: Domain may already exist or API rejected it. Skipping.`);
              }
          }

          console.log("🚀 Triggering Application deployment...");
          await fetchDokploy('/application.deploy', 'POST', { applicationId: appId });
          console.log(`⏳ Waiting for Application deployment to finish... (this may take a minute)`);
          
          let isFinished = false;
          let status = 'running';
          let attempts = 0;
          const maxAttempts = 60; // 5 minutes max wait
          
          while (!isFinished && attempts < maxAttempts) {
              await delay(5000);
              attempts++;
              try {
                  const currentProjects = await fetchDokploy('/project.all');
                  const p = currentProjects.find(p => p.name === projectName);
                  const e = p.environments[0];
                  const a = e.applications.find(a => a.name === appName);
                  status = a.applicationStatus;
                  
                  if (status === 'done' || status === 'error') {
                      isFinished = true;
                  } else {
                      process.stdout.write("."); // loading indicator
                  }
              } catch(e) {
                  // ignore network blips during polling
              }
          }
          
          console.log(""); // newline
          if (status === 'done') {
              console.log(`🎉 Deployment SUCCESSFUL! App should be live at https://${domain || appName}.`);
          } else {
              console.error(`❌ Deployment ended with status: ${status}.`);
              console.error(`\n⚠️  DOKPLOY LOGS UNAVAILABLE VIA API. Please log in to your Dokploy Dashboard -> '${projectName}' project -> '${appName}' -> 'Deployments' to see the exact build error.`);
          }
      }
    }

    console.log(`\n✅ All setup actions completed.`);
  } catch (error) {
    console.error("❌ Process failed:", error.message);
    process.exit(1);
  }
}

run();