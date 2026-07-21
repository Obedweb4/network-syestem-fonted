# Change all four values below before import. The Hotspot server must already exist.

:local hotspotProfile "hsprof1"
:local hotspotGateway "10.10.10.1"
:local captiveDnsName "login.pulsenet.test"
:local afterLoginUrl "https://portal.example.com/packages"

# Serve router-hosted login files and advertise the captive DNS name.
/ip hotspot profile set [find where name=$hotspotProfile] \
    dns-name=$captiveDnsName \
    html-directory=hotspot \
    login-by=http-chap,http-pap,cookie \
    http-cookie-lifetime=1d \
    html-directory-override=""

# Resolve the advertised Hotspot hostname to the router on the Hotspot network.
# Do not add a second matching static entry if one already exists.
/ip dns set allow-remote-requests=yes
/ip dns static add name=$captiveDnsName address=$hotspotGateway comment="PulseNet captive portal"

# This is a deployment reminder; set the same value in hotspot/alogin.html.
:put ("After-login destination: " . $afterLoginUrl)

# Reminder: hotspot/login.html also needs TENANT_ID and API_BASE_URL set near
# the top of its <script> block, and API_BASE_URL's CORS_ORIGINS on api-server
# must include this router's captive DNS name (see mikrotik-hotspot/README.md).
:put ("Captive DNS name (add to api-server CORS_ORIGINS as http://" . $captiveDnsName . "): " . $captiveDnsName)
