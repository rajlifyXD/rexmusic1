import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SoapBubbleMaterial } from './soap-bubble';

type Scheme = 'light' | 'dark';

const MATERIALS = {
  light: {
    glass: 0.95,
    iridescence: 0.5,
    filmScale: 4.85,
    soapPaletteRed: '#F05A78',
    soapPaletteGold: '#E44765',
    soapPaletteGreen: '#D63A59',
    soapPaletteCyan: '#C93355',
    soapPaletteBlue: '#B82D4C',
    soapPaletteViolet: '#98253F',
    oilOpacity: 1,
    oilCoverage: 0.73,
    oilEdge: 18,
    oilEdgeFade: 2.33,
    clearCenter: 0.57,
    thickness: 480,
    drainage: 0.35,
    swirl: 0.5,
    reflectivity: 1.3,
    refraction: 0.15,
    dispersion: 1,
    bevel: 14,
  },
  dark: {
    // Chromatic treatment: remove the broad interference-film rainbow and
    // emphasize red/blue channel separation at the refracted glass edges.
    glass: 0.95,
    iridescence: 0,
    filmScale: 4.85,
    soapPaletteRed: '#F05A78',
    soapPaletteGold: '#E44765',
    soapPaletteGreen: '#D63A59',
    soapPaletteCyan: '#C93355',
    soapPaletteBlue: '#B82D4C',
    soapPaletteViolet: '#98253F',
    oilOpacity: 0,
    oilCoverage: 0,
    oilEdge: 18,
    oilEdgeFade: 1,
    clearCenter: 1,
    thickness: 480,
    drainage: 0.35,
    swirl: 0.08,
    reflectivity: 1.3,
    refraction: 0.32,
    dispersion: 1.8,
    bevel: 14,
  },
} as const;

const REFLECTIONS = {
  windowLength: 1.3,
  windowMargin: 0.85,
  windowBend: 0.75,
  windowSize: 0.75,
  windowWidth: 0.8,
  windowGradient: 0.96,
  windowHead: 0.7,
  windowTail: 0.6,
  glintSize: 1.65,
  glintIntensity: 0,
  glintDistance: -0.45,
  glintHeight: 0.65,
  windowIntensity: 0.85,
  windowTwin: false,
  bottomShadeColor: '#ffffff',
} as const;

function readScheme(): Scheme {
  const explicit = document.documentElement.getAttribute('data-theme')
    ?? document.body.getAttribute('data-theme');
  if (explicit === 'light') return 'light';
  // Rex's shipped interface is dark by design. Explicit `data-theme="light"`
  // on the host switches the material to the catalog's light preset.
  return 'dark';
}

export default function RexBubbleMaterial({ children }: { children: ReactNode }) {
  const [scheme, setScheme] = useState<Scheme>(() => readScheme());
  const backdrop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const refresh = () => setScheme(readScheme());
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
    refresh();
    return () => observer.disconnect();
  }, []);

  return (
    <div className="rex-app-material-root">
      {/* A stable ambient backdrop keeps Bubble UI refraction away from live page text.
          The navbar has its own live Liquid Glass renderer and keeps real backdrop blur. */}
      <div ref={backdrop} className="rex-app-glass-backdrop" aria-hidden="true" />
      <SoapBubbleMaterial
        backdrop={backdrop}
        {...MATERIALS[scheme]}
        {...REFLECTIONS}
        environment="auto"
      >
        <div className="rex-app-material-content">{children}</div>
      </SoapBubbleMaterial>
    </div>
  );
}
