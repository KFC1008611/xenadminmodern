import { AUDITED_FEATURE_IDS, getAuditedFeatureBlockReason } from '../../../../shared/audited-features'
import { getCapabilityClaim } from '../../../../shared/evidence-manifest'

export function B0GuardEvidencePage() {
  return (
    <main className="min-h-screen bg-background p-8 text-foreground" data-b0-guard-evidence>
      <h1 className="text-2xl font-semibold">B0 门禁观察</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        该只读页面仅用于核对打包 renderer 中的门禁身份与原因，不开放任何 mutation。
      </p>
      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        {AUDITED_FEATURE_IDS.map((id) => {
          const claim = getCapabilityClaim(id)
          const guardReason = getAuditedFeatureBlockReason(id)
          return (
            <section
              key={id}
              className="rounded-lg border border-warning/25 bg-card p-3"
              data-b0-feature-id={id}
              data-b0-guard-reason={guardReason}
              data-b0-source-commit={claim.sourceCommit}
            >
              <div className="font-mono text-xs text-warning">{id}</div>
              <div className="mt-1 font-medium">{claim.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{guardReason}</p>
            </section>
          )
        })}
      </div>
    </main>
  )
}
