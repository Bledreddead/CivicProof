
"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

const categories = [
  { value: "road", label: "Road damage", icon: "⌁", description: "Potholes, damaged roads and broken surfaces" },
  { value: "water", label: "Water leakage", icon: "◈", description: "Leaking pipes and water supply issues" },
  { value: "garbage", label: "Garbage accumulation", icon: "▤", description: "Uncollected waste and overflowing bins" },
  { value: "drainage", label: "Drainage issue", icon: "≋", description: "Blocked drains and waterlogging" },
  { value: "streetlight", label: "Streetlight failure", icon: "☼", description: "Non-functional public lighting" },
  { value: "other", label: "Other civic issue", icon: "⌖", description: "Other public infrastructure concerns" },
];

const steps = [
  "Register incident",
  "Upload evidence & AI analysis",
  "Generate semantic embedding",
  "Calculate priority",
  "Generate action brief",
];

function SectionHeading({
  number,
  eyebrow,
  title,
  description,
}: {
  number: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-7">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-cyan-400">{number}</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-cyan-400">
          {eyebrow}
        </span>
      </div>
      <h2 className="mt-3 text-xl font-semibold tracking-tight text-white md:text-2xl">
        {title}
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">
        {description}
      </p>
    </div>
  );
}

export default function ReportPage() {
  const router = useRouter();
  const { session, profile, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !session) {
      router.replace("/login");
    }
  }, [authLoading, session, router]);

  const isAdmin = profile?.role === "admin";
  const fileInput = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("road");
  const [locationText, setLocationText] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState("");

  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [stage, setStage] = useState(0);

  function handleImage(file?: File) {
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Please upload a JPG, PNG or WEBP image.");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError("Image must be smaller than 8 MB.");
      return;
    }

    setError("");
    setImage(file);
    setPreview(URL.createObjectURL(file));
  }

  function removeImage() {
    if (preview) URL.revokeObjectURL(preview);
    setImage(null);
    setPreview("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function captureLocation() {
    setError("");

    if (!navigator.geolocation) {
      setError("GPS is not supported by this browser.");
      return;
    }

    setGpsLoading(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(7));
        setLongitude(position.coords.longitude.toFixed(7));
        setGpsLoading(false);
      },
      (gpsError) => {
        setGpsLoading(false);
        setError(
          gpsError.code === 1
            ? "Location permission denied. Enter coordinates manually."
            : "Could not obtain GPS location. Try entering coordinates manually."
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  }

  async function submitReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!image) {
      setError("Please attach a photograph of the civic issue.");
      return;
    }

    if (Boolean(latitude.trim()) !== Boolean(longitude.trim())) {
      setError("Enter both latitude and longitude.");
      return;
    }

    let lat: number | null = null;
    let lng: number | null = null;

    if (latitude.trim() && longitude.trim()) {
      lat = Number(latitude);
      lng = Number(longitude);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        setError("Please enter valid latitude and longitude coordinates.");
        return;
      }
    }

        if (!session?.access_token) {
      setError("Your session has expired. Please sign in again.");
      router.replace("/login");
      return;
    }

    const authHeaders = {
      Authorization: `Bearer ${session.access_token}`,
    };

    setLoading(true);
    setStage(1);
    setProgress("Registering your civic incident...");

    try {
      // 1. Create the report.
      const reportResponse = await fetch(`${API_URL}/reports`, {
        method: "POST",
                headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
          location_text: locationText.trim() || null,
          latitude: lat,
          longitude: lng,
        }),
      });

      const reportResult = await reportResponse.json();

      if (!reportResponse.ok) {
        throw new Error(
          reportResult.detail || "Could not register the report."
        );
      }

      const reportId = reportResult.report?.id;

      if (!reportId) {
        throw new Error("Report was created, but its ID was not returned.");
      }

      // 2. Upload evidence and run Gemini visual analysis.
            // 2. Upload evidence.
      setStage(2);
      setProgress(
        isAdmin
          ? "Uploading evidence and running AI image analysis..."
          : "Uploading your photographic evidence..."
      );

      const formData = new FormData();
      formData.append("description", description.trim());
      formData.append("image", image);

      if (!isAdmin) {
        // Citizen: upload evidence without triggering admin AI processing.
        const evidenceResponse = await fetch(
          `${API_URL}/reports/${reportId}/evidence`,
          {
            method: "POST",
            headers: authHeaders,
            body: formData,
          }
        );

        const evidenceResult = await evidenceResponse.json();

        if (!evidenceResponse.ok) {
          throw new Error(
            `Report saved, but evidence upload failed: ${
              evidenceResult.detail || "Unknown error"
            }. Report ID: ${reportId}`
          );
        }

        setProgress("Report submitted successfully. Opening your reports...");
        router.push("/my-reports");
        return;
      }

      // Admin: retain the existing AI analysis workflow.
      formData.append("report_id", reportId);

      const analysisResponse = await fetch(`${API_URL}/analyse-image`, {
        method: "POST",
        headers: authHeaders,
        body: formData,
      });

      const analysisResult = await analysisResponse.json();

      if (!analysisResponse.ok) {
        throw new Error(
          `Report saved, but image analysis failed: ${
            analysisResult.detail || "Unknown error"
          }. Report ID: ${reportId}`
        );
      }
      // 3. Generate semantic embedding.
      setStage(3);
      setProgress("Finding semantically similar civic incidents...");

      const embeddingResponse = await fetch(
        `${API_URL}/reports/${reportId}/embed`,
        {
          method: "POST",
          headers: authHeaders,
        }
      );

      const embeddingResult = await embeddingResponse.json();

      if (!embeddingResponse.ok) {
        throw new Error(
          `Image analysis succeeded, but embedding failed: ${
            embeddingResult.detail || "Unknown error"
          }. Report ID: ${reportId}`
        );
      }

      // 4. Calculate explainable priority score.
      setStage(4);
      setProgress("Calculating incident priority...");

      const triageResponse = await fetch(
        `${API_URL}/reports/${reportId}/triage`,
        { method: "POST" }
      );

      const triageResult = await triageResponse.json();

      if (!triageResponse.ok) {
        throw new Error(
          `Triage failed: ${
            triageResult.detail || "Unknown error"
          }. Report ID: ${reportId}`
        );
      }

      // 5. Generate evidence-backed action brief.
      setStage(5);
      setProgress("Generating the evidence-backed action brief...");

      const briefResponse = await fetch(
        `${API_URL}/reports/${reportId}/brief`,
        { method: "POST" }
      );

      const briefResult = await briefResponse.json();

      if (!briefResponse.ok) {
        throw new Error(
          `Action brief generation failed: ${
            briefResult.detail || "Unknown error"
          }. Report ID: ${reportId}`
        );
      }

      // 6. Open the investigation.
      setStage(6);
      setProgress("Incident successfully processed. Opening investigation...");

      router.push(`/investigation/${reportId}`);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#050607] text-white">      {/* Navigation */}
      <header className="sticky top-0 z-20 border-b border-white/[0.09] bg-[#050607]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 md:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 font-mono text-lg font-bold text-cyan-300">
              C
            </div>
            <div>
              <div className="text-base font-bold tracking-tight">
                CivicProof<span className="text-cyan-400">.</span>
              </div>
              <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-zinc-600">
                Evidence to action
              </div>
            </div>
          </Link>

          <Link
            href={isAdmin ? "/" : "/my-reports"}
            className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-xs text-zinc-400 transition hover:border-cyan-400/30 hover:text-cyan-300"
          >
            {isAdmin ? "Back to Command Centre" : "Back to My Reports"}
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5 py-10 md:px-8 md:py-16">
        {/* Intro */}
        <div className="mb-10 md:mb-14">
          <div className="mb-5 flex items-center gap-3">
            <span className="h-px w-8 bg-cyan-400" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-cyan-400">
              Citizen portal / Report an issue
            </span>
          </div>

          <h1 className="max-w-3xl text-4xl font-semibold leading-[1.1] tracking-[-0.045em] md:text-6xl">
            Your city.
            <br />
            <span className="text-zinc-500">Your evidence.</span>
            <br />
            <span className="text-cyan-400">Your voice.</span>
          </h1>

          <p className="mt-6 max-w-2xl text-sm leading-7 text-zinc-400 md:text-base">
            Help identify infrastructure problems in your neighbourhood.
            Submit a photograph and location. CivicProof will analyse the
            evidence, assess the incident and prepare an investigation record
            for review.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {[
              "Photographic evidence",
              "AI-assisted analysis",
              "Human review",
            ].map((item) => (
              <span
                key={item}
                className="rounded-full border border-white/[0.1] bg-white/[0.025] px-3 py-2 font-mono text-[9px] uppercase tracking-wider text-zinc-400"
              >
                <span className="mr-2 text-cyan-400">●</span>
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-xl border border-red-400/25 bg-red-400/[0.06] p-4">
            <div className="flex items-start gap-3">
              <span className="text-red-400">!</span>
              <div>
                <p className="text-sm font-semibold text-red-300">
                  Submission notice
                </p>
                <p className="mt-1 break-words text-xs leading-6 text-red-300/80">
                  {error}
                </p>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={submitReport} className="space-y-5">
          {/* Incident details */}
          <section className="rounded-xl border border-white/[0.09] bg-[#0a0c0f] p-5 md:p-8">
            <SectionHeading
              number="01"
              eyebrow="Incident details"
              title="What happened?"
              description="Describe the issue as clearly as possible. Accurate details help make the investigation more useful."
            />

            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-xs font-medium text-zinc-300">
                  Incident title <span className="text-cyan-400">*</span>
                </label>
                <input
                  required
                  minLength={3}
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Large pothole on main road"
                  disabled={loading}
                  className="w-full rounded-lg border border-white/[0.1] bg-[#050607] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-cyan-400/60 disabled:opacity-50"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-xs font-medium text-zinc-300">
                    Issue description <span className="text-cyan-400">*</span>
                  </label>
                  <span className="font-mono text-[9px] text-zinc-600">
                    {description.length} characters
                  </span>
                </div>
                <textarea
                  required
                  minLength={10}
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Explain what you observed, where it happened, how extensive the issue is, and whether it creates any immediate risks..."
                  disabled={loading}
                  className="w-full resize-y rounded-lg border border-white/[0.1] bg-[#050607] px-4 py-3.5 text-sm leading-7 text-white outline-none transition placeholder:text-zinc-700 focus:border-cyan-400/60 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="mb-3 block text-xs font-medium text-zinc-300">
                  Select issue category{" "}
                  <span className="text-cyan-400">*</span>
                </label>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {categories.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      disabled={loading}
                      onClick={() => setCategory(item.value)}
                      aria-pressed={category === item.value}
                      className={`group rounded-lg border p-4 text-left transition ${
                        category === item.value
                          ? "border-cyan-400/50 bg-cyan-400/[0.07]"
                          : "border-white/[0.09] bg-[#050607] hover:border-white/20"
                      } disabled:opacity-50`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span
                          className={`font-mono text-2xl ${
                            category === item.value
                              ? "text-cyan-300"
                              : "text-zinc-500"
                          }`}
                        >
                          {item.icon}
                        </span>
                        <span
                          className={`mt-1 flex h-4 w-4 items-center justify-center rounded-full border text-[9px] ${
                            category === item.value
                              ? "border-cyan-400 bg-cyan-400 text-black"
                              : "border-zinc-700 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      </div>
                      <p className="mt-3 text-sm font-medium text-zinc-200">
                        {item.label}
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-zinc-600">
                        {item.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Evidence */}
          <section className="rounded-xl border border-white/[0.09] bg-[#0a0c0f] p-5 md:p-8">
            <SectionHeading
              number="02"
              eyebrow="Visual evidence"
              title="Show us the issue."
              description="A real photograph is required for AI visual analysis. Upload a clear image that shows the reported issue."
            />

            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={loading}
              className="hidden"
              onChange={(e) => handleImage(e.target.files?.[0])}
            />

            {preview ? (
              <div className="overflow-hidden rounded-lg border border-white/[0.1] bg-[#050607]">
                <img
                  src={preview}
                  alt="Selected civic issue evidence"
                  className="max-h-[420px] w-full bg-black/30 object-contain"
                />

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] p-4">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-zinc-200">
                      {image?.name}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-zinc-600">
                      {image
                        ? `${(image.size / 1024 / 1024).toFixed(2)} MB`
                        : ""}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={loading}
                    onClick={removeImage}
                    className="text-xs text-red-400 transition hover:text-red-300 disabled:opacity-50"
                  >
                    Remove image ×
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={loading}
                onClick={() => fileInput.current?.click()}
                className="flex min-h-56 w-full flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.17] bg-[#050607] p-7 text-center transition hover:border-cyan-400/50 hover:bg-cyan-400/[0.025] disabled:opacity-50"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] font-mono text-2xl text-cyan-300">
                  ↑
                </span>
                <p className="mt-5 text-sm font-medium text-zinc-200">
                  Upload photographic evidence
                </p>
                <p className="mt-2 text-xs text-zinc-600">
                  Browse your device to select an image
                </p>
                <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-700">
                  JPG / PNG / WEBP · Maximum 8 MB
                </p>
              </button>
            )}

            <p className="mt-3 text-[10px] leading-5 text-zinc-600">
              Only JPEG, PNG and WEBP images up to 8 MB are accepted.
            </p>
          </section>

          {/* Location */}
          <section className="rounded-xl border border-white/[0.09] bg-[#0a0c0f] p-5 md:p-8">
            <SectionHeading
              number="03"
              eyebrow="Incident location"
              title="Where did it happen?"
              description="Location information helps identify nearby reports and assess geographic patterns."
            />

            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-xs font-medium text-zinc-300">
                  Location description
                </label>
                <input
                  value={locationText}
                  onChange={(e) => setLocationText(e.target.value)}
                  placeholder="e.g. Near railway station, Pune"
                  disabled={loading}
                  className="w-full rounded-lg border border-white/[0.1] bg-[#050607] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-cyan-400/60 disabled:opacity-50"
                />
              </div>

              <div className="rounded-lg border border-white/[0.08] bg-[#050607] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-zinc-200">
                      Geographic coordinates
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-600">
                      Use GPS or enter coordinates manually.
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={loading || gpsLoading}
                    onClick={captureLocation}
                    className="rounded-lg border border-cyan-400/25 bg-cyan-400/[0.07] px-4 py-2.5 text-xs font-medium text-cyan-300 transition hover:bg-cyan-400/[0.13] disabled:opacity-50"
                  >
                    {gpsLoading ? "Detecting..." : "◎ Detect my location"}
                  </button>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                      Latitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="-90"
                      max="90"
                      value={latitude}
                      onChange={(e) => setLatitude(e.target.value)}
                      placeholder="e.g. 18.5204"
                      disabled={loading}
                      className="w-full rounded-lg border border-white/[0.1] bg-[#0a0c0f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/60 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                      Longitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="-180"
                      max="180"
                      value={longitude}
                      onChange={(e) => setLongitude(e.target.value)}
                      placeholder="e.g. 73.8567"
                      disabled={loading}
                      className="w-full rounded-lg border border-white/[0.1] bg-[#0a0c0f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/60 disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              <p className="text-[10px] leading-5 text-zinc-600">
                GPS access requires browser permission. If unavailable, enter
                coordinates manually. Reports without coordinates can still
                be submitted, but geographic duplicate detection will be
                limited.
              </p>
            </div>
          </section>

          {/* Submission */}
          <section className="rounded-xl border border-white/[0.09] bg-[#0a0c0f] p-5 md:p-8">
            <SectionHeading
              number="04"
              eyebrow="Review and submit"
              title="Ready to make a report?"
              description="Your evidence will be processed into an investigation record for review."
            />

            <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.035] p-4">
              <div className="flex items-start gap-3">
                <span className="font-mono text-sm text-amber-400">i</span>
                <p className="text-xs leading-6 text-zinc-400">
                  AI-generated findings are preliminary and may require human
                  verification. CivicProof prepares evidence-backed
                  investigation records; submitting here does not constitute
                  an official municipal complaint or guarantee government
                  action.
                </p>
              </div>
            </div>

            {loading && (
              <div className="mt-6 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.035] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-medium text-cyan-300">
                    Processing your incident
                  </p>
                  <p className="font-mono text-xs text-zinc-500">
                    {Math.min(stage, isAdmin ? 5 : 2)} / {isAdmin ? 5 : 2}
                  </p>
                </div>

                <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-cyan-400 transition-all duration-500"
                    style={{
                      width: `${(Math.min(stage, isAdmin ? 5 : 2) / (isAdmin ? 5 : 2)) * 100}%`,
                    }}
                  />
                </div>

                <p className="mt-4 text-xs leading-5 text-zinc-300">
                  {progress}
                </p>

                <div className="mt-5 space-y-3">
                {(isAdmin
                    ? steps
                    : ["Register incident", "Upload photographic evidence"]
                  ).map((step, index) => {
                    const complete = stage > index + 1;
                    const current = stage === index + 1;

                      if (authLoading || !session || !profile) {
                        return (
                          <main className="flex min-h-screen items-center justify-center bg-[#050607] text-sm text-zinc-400">
                            Checking your account...
                            </main>
                        );
                      }

                    return (
                      <div key={step} className="flex items-center gap-3">
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] ${
                            complete
                              ? "border-cyan-400 bg-cyan-400 text-black"
                              : current
                                ? "border-cyan-400 text-cyan-300"
                                : "border-white/10 text-zinc-700"
                          }`}
                        >
                          {complete ? "✓" : index + 1}
                        </span>
                        <span
                          className={`text-xs ${
                            complete
                              ? "text-cyan-300"
                              : current
                                ? "text-white"
                                : "text-zinc-600"
                          }`}
                        >
                          {step}
                        </span>
                        {current && (
                          <span className="ml-auto font-mono text-[9px] uppercase tracking-wider text-cyan-400">
                            Running
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg bg-cyan-400 px-6 py-4 text-sm font-semibold text-[#041014] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Processing your report..." : "Submit civic report"}
              {!loading && <span className="text-lg">→</span>}
            </button>

            <p className="mt-4 text-center font-mono text-[9px] uppercase tracking-[0.13em] text-zinc-700">
              Evidence-backed reporting / AI-assisted analysis / Human review
            </p>
          </section>
        </form>

        {/* Footer */}
        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-6 font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-700">
          <span>CivicProof / Citizen portal</span>
          <span>Evidence to action intelligence</span>
        </footer>
      </div>
    </main>
  );
}

