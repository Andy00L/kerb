import Link from "next/link";
import { HeroArtifact } from "@/components/kerb/HeroArtifact";
import { Reveal } from "@/components/kerb/Reveal";
import { buildThreadPoints } from "@/lib/thread";
import styles from "./page.module.css";

const HOW_IT_WORKS: ReadonlyArray<readonly [string, string]> = [
  ["01", "Encrypt in your browser. The strategy never leaves in cleartext."],
  ["02", "Fund by XRPL deposit, proven on-chain by FDC."],
  ["03", "The enclave watches FTSOv2 prices and fires the trigger."],
  ["04", "Fills and settlement land on the DEX, proven on-chain."],
];

const SEALED_ITEMS: ReadonlyArray<readonly [string, number]> = [
  ["Trigger price", 52],
  ["Slice sizes", 44],
  ["Timing jitter", 36],
];

const PROVEN_ITEMS: ReadonlyArray<readonly [string, string]> = [
  ["Deposit", "88D4…6C1F"],
  ["Each fill", "A3F0…9C21"],
  ["Settlement", "E67B…21AC"],
];

export default function LandingPage() {
  const threadPoints = buildThreadPoints(96, 1400, 70, 0.42);

  return (
    <div className={styles.page}>
      <div className={styles.finish} aria-hidden="true">
        <div className={styles.grade} />
        <div className={styles.grain} />
        <div className={styles.vignette} />
      </div>

      <div className={styles.content}>
        <nav className={styles.nav}>
          <div className={`container ${styles.navInner}`}>
            <span className={styles.wordmark}>Kerb</span>
            <div className={styles.navLinks}>
              <a href="#how" className={styles.navLink}>
                How it works
              </a>
              <a href="#footer" className={styles.navLink}>
                Runbook
              </a>
              <Link href="/app" className={`btn btnPrimary ${styles.navCta}`}>
                Launch app
              </Link>
            </div>
          </div>
        </nav>

        <section className={styles.hero}>
          <div className={styles.heroThread} aria-hidden="true">
            <svg
              viewBox="0 0 1400 220"
              preserveAspectRatio="none"
              className={styles.heroThreadSvg}
            >
              <polyline
                points={threadPoints}
                fill="none"
                stroke="var(--ink-muted)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                opacity={0.55}
              />
            </svg>
            <div className={styles.heroBand} />
          </div>

          <div className={`container ${styles.heroInner}`}>
            <div className={`${styles.heroCopy} rise`}>
              <h1 className={styles.headline}>
                Your exit plan, <span className={styles.headlineQuiet}>sealed.</span>
              </h1>
              <p className={styles.support}>
                Kerb executes stop, limit and DCA orders on the XRPL DEX from
                inside a Flare TEE. Nobody sees the trigger, everybody can
                verify the result.
              </p>
              <Link href="/app" className={`btn btnPrimary ${styles.heroCta}`}>
                Launch app
              </Link>
            </div>
            <div className={`${styles.heroArtifactSlot} rise`}>
              <HeroArtifact />
            </div>
          </div>
        </section>

        <Reveal>
          <section className={`container ${styles.section}`}>
            <h2 className={styles.sectionTitle}>
              What stays sealed, what stays provable
            </h2>
            <div className={`card ${styles.ledger}`}>
              <div className={styles.ledgerSealed}>
                <div className={styles.ledgerHead}>
                  <span className="eyebrow">Sealed</span>
                  <span className={`mono ${styles.sealedCaption}`}>
                    Sealed in TEE
                  </span>
                </div>
                {SEALED_ITEMS.map(([label, barWidth]) => (
                  <div key={label} className={styles.ledgerRow}>
                    <span>{label}</span>
                    <span
                      className="sealed"
                      style={{ width: `${barWidth}px` }}
                    />
                  </div>
                ))}
              </div>
              <div className={styles.ledgerProven}>
                <div className={styles.ledgerHead}>
                  <span className="eyebrow">Proven</span>
                </div>
                {PROVEN_ITEMS.map(([label, hash]) => (
                  <div key={label} className={styles.provenRow}>
                    <span>{label}</span>
                    <span className={`mono ${styles.provenHash}`}>{hash}</span>
                    <span className="seal">FDC attested ✓</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section id="how" className={`container ${styles.section}`}>
            <h2 className={styles.sectionTitle}>How it works</h2>
            <div className={styles.steps}>
              {HOW_IT_WORKS.map(([number, sentence]) => (
                <div key={number}>
                  <div className={`mono ${styles.stepNumber}`}>{number}</div>
                  <p className={styles.stepText}>{sentence}</p>
                </div>
              ))}
            </div>
          </section>
        </Reveal>

        <footer id="footer" className={styles.footer}>
          <div className={`container ${styles.footerLinks}`}>
            <a
              href="https://dev.flare.network"
              className={styles.footerLink}
              rel="noreferrer"
              target="_blank"
            >
              Flare docs
            </a>
            <a
              href="https://testnet.xrpl.org"
              className={styles.footerLink}
              rel="noreferrer"
              target="_blank"
            >
              XRPL testnet explorer
            </a>
          </div>
          <div className={`container ${styles.footerWordmark}`} aria-hidden="true">
            KERB
          </div>
        </footer>
      </div>
    </div>
  );
}
