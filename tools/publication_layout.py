"""Group an existing audit by manufacturer, television type and exact model."""
from html import escape
import re


def structure_publication_audit(document, manufacturer='Samsung', tv_type='Crystal UHD TV', model='UA50DU7700WXXY'):
    # Safe to run again on the same snapshot without nesting or duplicating it.
    if 'data-device-hierarchy="manufacturer-type-model"' in document:
        return document
    main = re.search(r'<main>(.*)</main>', document, re.S)
    if not main:
        raise ValueError('The audit document has no main content.')
    report = main.group(1)
    report = re.sub(r'<h1>(.*?)</h1>', r'<h5 class="audit-title">\1</h5>', report, flags=re.S)
    report = report.replace('<h2>', '<h5 class="audit-section-title">').replace('</h2>', '</h5>')
    report = report.replace('<h3>', '<h6 class="audit-subsection-title">').replace('</h3>', '</h6>')
    report = report.replace('Publication readiness · 28 October 2026', 'Audit snapshot · 28 October 2026')
    report = report.replace('Current source and signed widget, independently checked against Samsung’s publication, quality, security and API guidance.',
                            'Source and signed widget reviewed on 28 October 2026 against Samsung’s publication, quality, security and API guidance.')
    hierarchy = f'''
<div class="device-audit" data-device-hierarchy="manufacturer-type-model">
  <header class="directory-header"><span class="eyebrow">SART Gallery · Publication audit</span><h1>Manufacturer, type &amp; model</h1><p class="muted">Audit findings organised by the television they cover.</p></header>
  <nav class="device-breadcrumb" aria-label="Device hierarchy"><a href="#manufacturer-samsung">{escape(manufacturer)}</a><span aria-hidden="true">›</span><a href="#type-crystal-uhd">{escape(tv_type)}</a><span aria-hidden="true">›</span><a href="#model-ua50du7700wxxy">{escape(model)}</a></nav>
  <section class="manufacturer-group" id="manufacturer-samsung" aria-labelledby="manufacturer-title"><div class="hierarchy-heading"><span class="hierarchy-kind">Manufacturer</span><h2 id="manufacturer-title">{escape(manufacturer)}</h2></div>
    <section class="type-group" id="type-crystal-uhd" aria-labelledby="type-title"><div class="hierarchy-heading"><span class="hierarchy-kind">Type</span><h3 id="type-title">{escape(tv_type)}</h3></div>
      <article class="model-group" id="model-ua50du7700wxxy" aria-labelledby="model-title"><div class="model-heading"><div><span class="hierarchy-kind">Model</span><h4 id="model-title">{escape(model)}</h4></div><span class="model-size">50-inch television</span></div>
        <div class="snapshot-context">Historical audit · SART Gallery 0.4.2 · 28 October 2026</div>
        <div class="audit-report">{report}</div>
      </article>
    </section>
  </section>
</div>
'''
    document = document[:main.start(1)] + hierarchy + document[main.end(1):]
    style = '''
/* Manufacturer > Type > Model document hierarchy. */
.directory-header { margin-bottom:18px; }
.directory-header h1 { font-size:38px; }
.device-breadcrumb { align-items:center; gap:12px; margin:22px 0 34px; }
.device-breadcrumb span { color:var(--muted); }
.manufacturer-group { border-top:3px solid var(--gold); padding-top:20px; }
.hierarchy-kind { display:block; color:var(--muted); font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
.hierarchy-heading h2 { margin:2px 0 22px; font-size:32px; }
.type-group { margin-left:14px; border-left:2px solid var(--line); padding-left:24px; }
.hierarchy-heading h3 { margin:2px 0 20px; font-size:24px; }
.model-group { margin:0 0 16px; min-width:0; }
.model-heading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; background:#e7ecef; border-radius:8px 8px 0 0; padding:18px 22px; }
.model-heading h4 { margin:3px 0 0; font-size:21px; font-weight:600; overflow-wrap:anywhere; }
.model-size { font-size:13px; color:var(--muted); }
.snapshot-context { background:#f5ead7; color:#72501f; padding:10px 22px; font-size:12px; }
.audit-report { padding-top:22px; }
.audit-report .audit-title { font:400 34px/1.18 Georgia,serif; margin:12px 0; letter-spacing:0; }
.audit-report .audit-section-title { font-size:25px; font-weight:700; margin:38px 0 16px; }
.audit-report .audit-subsection-title { font-size:18px; font-weight:700; margin:26px 0 12px; }
.audit-report nav { margin:22px 0; }
@media(max-width:800px) { .directory-header h1{font-size:30px}.type-group{margin-left:5px;padding-left:12px}.model-heading{padding:14px}.snapshot-context{padding:10px 14px}.audit-report .audit-title{font-size:28px}.hierarchy-heading h2{font-size:28px}.hierarchy-heading h3{font-size:22px}.model-heading h4{font-size:18px} }
@media print { .device-breadcrumb{display:none}.type-group{margin-left:0;padding-left:12px}.manufacturer-group{border-top-width:1px}.hierarchy-heading,.model-heading,.snapshot-context,.audit-section-title{break-after:avoid}.audit-report .audit-title{font-size:25px}.audit-report .audit-section-title{font-size:20px} }
'''
    return document.replace('</style>', style + '</style>', 1)
