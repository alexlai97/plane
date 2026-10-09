# Upstream provenance

- Project: https://github.com/kekingcn/kkFileView
- Release: v5.0.3
- Source commit: 3b82689a676e8a7e7d3ec4cc0c74de0676b0dac9
- License: upstream-LICENSE (Apache-2.0); bundled dependencies retain their licenses in upstream artifacts.
- Built on 2026-10-09 using Maven with Java release target21; no upstream Java/parser changes.
- Docker base: pinned eclipse-temurin21 JRE on Ubuntu Noble, LibreOffice Writer/Calc/Impress, Noto CJK.
- Our changes: deployment configuration and Plane's narrow authenticated preview adapter, outside upstream parsing code.
- Build: clone/check out the commit, run `mvn -B package -Dmaven.test.skip=true`; place server/target/kkFileView-5.0.3.jar as kkFileView.jar in an isolated Docker context with Dockerfile, application.properties, upstream-LICENSE; build Dockerfile.base then Dockerfile.
- Browser acceptance includes MD table, Chinese Word and PPTX converted PDF, XLSX sheets, PDF, audio/video playback and original download integrity.
- No support promise for every advertised upstream format: initial Plane adapter only allows its explicit preview extensions. No CAD/3D, HTML, archive or external-URL preview routes are exposed.
