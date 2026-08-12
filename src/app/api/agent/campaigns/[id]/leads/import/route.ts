import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AGENT_READONLY_LEAD_FIELDS } from "@/lib/agent-lead-fields";
import {
  finalizeImportedLeadRow,
  LEAD_IMPORT_PHONE_FIELD_KEYS,
  normalizeImportPhoneField,
  pickAndSanitizeLeadImportFields,
} from "@/lib/lead-import-sanitize";
import { normalizeLeadTaggingValue } from "@/lib/lead-tagging";

export const dynamic = "force-dynamic";

const AGENT_IMPORT_FIELDS = [
  "name",
  "first_name",
  "last_name",
  "salutation",
  "company_name",
  "phone",
  "email",
  "domain",
  "direct_number",
  "company_number",
  "phone_number_link",
  "job_title",
  "job_level",
  "department",
  "job_function",
  "job_title_link",
  "tenurity",
  "vv_status",
  "address",
  "address2",
  "address_link",
  "city",
  "state",
  "country",
  "zip_code",
  "employee_size",
  "actual_employee_size",
  "see_all_employees",
  "industry",
  "industry_type_link",
  "employee_size_link",
  "asset_title2",
  "company_website_link",
  "revenue_range",
  "revenue_link",
  "sic_code",
  "sic_code_link",
  "naics_code",
  "naics_code_link",
  "founded_years",
  "founded_years_link",
  "contact_linkedin_url",
  "company_linkedin_url",
  "scored",
  "scored_timezone",
  "appointment",
  "appointment_timezone",
  "lead_type",
  "lead_tagging",
  "ra_comment",
  "special_comments",
  "call_back",
  "call_notes",
  "followup_date",
  "notes",
  "status",
] as const;

const AGENT_IMPORT_BLOCKED = new Set<string>(AGENT_READONLY_LEAD_FIELDS);

function sanitizeAgentImportRow(
  row: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...row };
  for (const key of AGENT_IMPORT_BLOCKED) {
    delete out[key];
  }
  return out;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("users")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    const orgId = (profile as { organization_id: string | null } | null)
      ?.organization_id;
    if (!orgId) {
      return NextResponse.json({ error: "No organization" }, { status: 400 });
    }

    const { id: campaignId } = await params;
    if (!campaignId) {
      return NextResponse.json(
        { error: "Campaign ID required" },
        { status: 400 }
      );
    }

    const { data: assignment } = await supabase
      .from("campaign_assignments")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("agent_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!assignment) {
      return NextResponse.json(
        { error: "You are not assigned to this campaign" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const rawLeads = Array.isArray(body?.leads) ? body.leads : [];
    if (rawLeads.length === 0) {
      return NextResponse.json({ error: "No leads to import" }, { status: 400 });
    }
    if (rawLeads.length > 500) {
      return NextResponse.json(
        { error: "Maximum 500 leads per import" },
        { status: 400 }
      );
    }

    const errors: string[] = [];
    let created = 0;
    let updated = 0;

    for (let i = 0; i < rawLeads.length; i++) {
      const row = finalizeImportedLeadRow(
        rawLeads[i] as Record<string, unknown>
      );

      const rowIdRaw = row.id as string | number | undefined;
      const rowId = rowIdRaw != null ? String(rowIdRaw).trim() : "";
      const rowLeadIdRaw = row.lead_id as string | number | undefined;
      const rowLeadId =
        rowLeadIdRaw != null ? String(rowLeadIdRaw).trim() : "";

      const fields = pickAndSanitizeLeadImportFields(
        sanitizeAgentImportRow(row),
        AGENT_IMPORT_FIELDS
      );
      const first_name = normalizeString(fields.first_name);
      const last_name = normalizeString(fields.last_name);
      const name = normalizeString(fields.name);
      const company_name = normalizeString(fields.company_name);
      const email = normalizeString(fields.email);
      const domain = normalizeString(fields.domain);
      const phone = normalizeImportPhoneField(fields.phone);
      const direct_number = normalizeImportPhoneField(fields.direct_number);
      const company_number = normalizeImportPhoneField(fields.company_number);

      const derivedName =
        [first_name, last_name].filter(Boolean).join(" ").trim() ||
        name ||
        null;

      let existingLeadId: string | null = rowId || null;

      if (!existingLeadId && rowLeadId) {
        const { data: existingByLeadId, error: lookupError } = await supabase
          .from("leads")
          .select("id")
          .eq("lead_id", rowLeadId)
          .eq("campaign_id", campaignId)
          .eq("organization_id", orgId)
          .eq("assigned_agent_id", user.id)
          .maybeSingle();

        if (lookupError) {
          errors.push(`Row ${i + 1}: ${lookupError.message}`);
          continue;
        }
        existingLeadId =
          (existingByLeadId as { id: string } | null)?.id ?? null;
        if (!existingLeadId) {
          errors.push(
            `Row ${i + 1}: Lead not found (${rowLeadId}). Export leads first and keep the lead_id column when editing.`
          );
          continue;
        }
      }

      const leadStatus =
        typeof fields.status === "string" && fields.status.length > 0
          ? (fields.status as string)
          : "new";

      const upsertPayload: Record<string, unknown> = {
        name: derivedName || null,
        first_name,
        last_name,
        salutation: fields.salutation ?? null,
        company_name,
        phone,
        email,
        domain,
        direct_number,
        company_number,
        phone_number_link: fields.phone_number_link ?? null,
        job_title: fields.job_title ?? null,
        job_level: fields.job_level ?? null,
        department: fields.department ?? null,
        job_function: fields.job_function ?? null,
        job_title_link: fields.job_title_link ?? null,
        tenurity: fields.tenurity ?? null,
        vv_status: fields.vv_status ?? null,
        address: fields.address ?? null,
        address2: fields.address2 ?? null,
        address_link: fields.address_link ?? null,
        city: fields.city ?? null,
        state: fields.state ?? null,
        country: fields.country ?? null,
        zip_code: fields.zip_code ?? null,
        employee_size: fields.employee_size ?? null,
        actual_employee_size: fields.actual_employee_size ?? null,
        see_all_employees: fields.see_all_employees ?? null,
        industry: fields.industry ?? null,
        industry_type_link: fields.industry_type_link ?? null,
        employee_size_link: fields.employee_size_link ?? null,
        asset_title2: fields.asset_title2 ?? null,
        company_website_link: fields.company_website_link ?? null,
        revenue_range: fields.revenue_range ?? null,
        revenue_link: fields.revenue_link ?? null,
        sic_code: fields.sic_code ?? null,
        sic_code_link: fields.sic_code_link ?? null,
        naics_code: fields.naics_code ?? null,
        naics_code_link: fields.naics_code_link ?? null,
        founded_years:
          fields.founded_years != null ? Number(fields.founded_years) : null,
        founded_years_link: fields.founded_years_link ?? null,
        contact_linkedin_url: fields.contact_linkedin_url ?? null,
        company_linkedin_url: fields.company_linkedin_url ?? null,
        scored: fields.scored ?? null,
        scored_timezone: fields.scored_timezone ?? null,
        appointment: fields.appointment ?? null,
        appointment_timezone: fields.appointment_timezone ?? null,
        lead_type: fields.lead_type ?? null,
        ra_comment: fields.ra_comment ?? null,
        special_comments: fields.special_comments ?? null,
        call_back: fields.call_back ?? null,
        call_notes: fields.call_notes ?? null,
        followup_date: fields.followup_date ?? null,
        notes: fields.notes ?? null,
        status: leadStatus,
      };

      // Only write lead_tagging when the spreadsheet provided it (or
      // finalizeImportedLeadRow salvaged/defaulted it onto `fields`).
      if ("lead_tagging" in fields) {
        const tagging =
          typeof fields.lead_tagging === "string"
            ? normalizeLeadTaggingValue(fields.lead_tagging)
            : null;
        upsertPayload.lead_tagging = tagging;
      }

      if (existingLeadId) {
        const updatePayload = { ...upsertPayload };
        for (const key of LEAD_IMPORT_PHONE_FIELD_KEYS) {
          if (!(key in fields)) delete updatePayload[key];
        }

        const { data: updatedRow, error: updateError } = await supabase
          .from("leads")
          .update(updatePayload as never)
          .eq("id", existingLeadId)
          .eq("campaign_id", campaignId)
          .eq("organization_id", orgId)
          .eq("assigned_agent_id", user.id)
          .select("id")
          .maybeSingle();

        if (updateError) {
          errors.push(`Row ${i + 1}: ${updateError.message}`);
        } else if (!updatedRow) {
          errors.push(`Row ${i + 1}: Lead not found or not assigned to you`);
        } else {
          updated++;
        }
        continue;
      }

      if (!derivedName && !company_name && !email && !phone) {
        errors.push(
          `Row ${i + 1}: At least one of name, company, email, or phone is required`
        );
        continue;
      }

      if (
        first_name &&
        last_name &&
        email &&
        company_name &&
        domain
      ) {
        const { data: duplicateLeads, error: duplicateError } = await supabase
          .from("leads")
          .select("id, lead_id")
          .eq("organization_id", orgId)
          .eq("campaign_id", campaignId)
          .eq("first_name", first_name)
          .eq("last_name", last_name)
          .eq("email", email)
          .eq("company_name", company_name)
          .eq("domain", domain)
          .limit(1);

        if (duplicateError) {
          errors.push(`Row ${i + 1}: ${duplicateError.message}`);
          continue;
        }

        if (duplicateLeads && duplicateLeads.length > 0) {
          const existing = duplicateLeads[0] as {
            id: string;
            lead_id: string | null;
          };
          errors.push(
            `Row ${i + 1}: Duplicate lead (${existing.lead_id ?? existing.id}). Use export with lead_id to update existing leads.`
          );
          continue;
        }
      }

      const { error: insertError } = await supabase.from("leads").insert({
        organization_id: orgId,
        campaign_id: campaignId,
        assigned_agent_id: user.id,
        ...upsertPayload,
        created_by: user.id,
      } as never);

      if (insertError) {
        errors.push(`Row ${i + 1}: ${insertError.message}`);
      } else {
        created++;
      }
    }

    return NextResponse.json({
      created,
      updated,
      total: rawLeads.length,
      errors,
    });
  } catch (err) {
    console.error("Agent leads import error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
