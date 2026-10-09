FROM bokang/file-preview-base:java21-lo
COPY --chown=preview:preview kkFileView.jar /opt/preview/bin/kkFileView.jar
COPY --chown=preview:preview application.properties /opt/preview/config/application.properties
COPY --chown=preview:preview upstream-LICENSE /opt/preview/upstream-LICENSE
ENV KKFILEVIEW_BIN_FOLDER=/opt/preview/bin
ENV JAVA_TOOL_OPTIONS="-Xms128m -Xmx768m -Dfile.encoding=UTF-8"
EXPOSE 8012
ENTRYPOINT ["java", "-Dspring.config.location=/opt/preview/config/application.properties", "-jar", "/opt/preview/bin/kkFileView.jar"]
