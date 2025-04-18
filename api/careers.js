import { WebflowClient } from "webflow-api";
import * as cheerio from "cheerio";

const client = new WebflowClient({ accessToken: process.env.WEBFLOW_API_KEY });

// 1. SCRAPE les offres Breezy
async function scrapeJobs() {
  const response = await fetch("https://zeno-power.breezy.hr/");
  const html = await response.text();
  const $ = cheerio.load(html);
  const jobs = [];

  $(".position").each((_, element) => {
    const title = $(element).find("h2").text().trim();
    const department = $(element).find(".department").text().trim();
    const location = $(element).find(".location").text().trim();
    const link = $(element).find("a").attr("href");
    const comp = $(element).find('[title="Salary"]').text().trim();
    const slug = link?.split("/").pop();
    const typeText = $(element).find(".type span").text().trim();
    const type = typeText.includes("FULL") ? "Full-Time"
                : typeText.includes("PART") ? "Part-Time"
                : typeText.includes("CONTRACT") ? "Contract"
                : "";

    jobs.push({
      title,
      department,
      location,
      link: link ? `https://zeno-power.breezy.hr${link}` : null,
      comp,
      slug: slug || null,
      type,
    });
  });

  return jobs;
}

// 2. Récupère les items Webflow déjà publiés
async function getOpenings() {
  const openings = await client.collections.items.listItemsLive("67dc46532575e8231ca7988c");
  return openings;
}

// 3. Identifie les nouveautés et les suppressions
function matchJobsToOpenings(jobs, openings) {
  const newJobs = jobs.filter(job => !openings.some(opening => opening.fieldData.slug === job.slug));
  const jobsToRemove = openings.filter(opening => !jobs.some(job => job.slug === opening.fieldData.slug));
  return { newJobs, jobsToRemove };
}

// 4. Structure format CMS
function formatJob(job) {
  return {
    id: job.slug,
    cmsLocaleId: "6759f13adb2adfac650b7ee0", // garde ce champ si Webflow Locales sont utilisés
    fieldData: {
      name: job.title,
      slug: job.slug,
      location: job.location,
      type: job.type,
      url: job.slug,
      comp: job.comp,
    },
  };
}

// 5. Ajoute les nouvelles offres
async function addJobs(jobs) {
  return await client.collections.items.createItemLive("67dc46532575e8231ca7988c", {
    items: jobs.map(formatJob),
  });
}

// 6. Supprime les anciennes offres
async function removeJobs(jobs) {
  const results = await Promise.all(
    jobs.map(job =>
      client.collections.items.deleteItemLive("67dc46532575e8231ca7988c", job.id)
    )
  );
  return results;
}

// 7. ROUTE GET
export async function GET() {
  try {
    const [jobs, { items: openings }] = await Promise.all([scrapeJobs(), getOpenings()]);
    const { newJobs, jobsToRemove } = matchJobsToOpenings(jobs, openings);

    let addedJobsOutput = [];
    let removedJobsOutput = [];

    if (newJobs.length > 0) {
      const added = await addJobs(newJobs);
      addedJobsOutput = added.items;
    }

    if (jobsToRemove.length > 0) {
      const removed = await removeJobs(jobsToRemove);
      removedJobsOutput = removed;
    }

    return new Response(
      JSON.stringify({
        status: "success",
        newJobs,
        jobsToRemove,
        addedJobsOutput,
        removedJobsOutput,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ status: "error", message: e.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
