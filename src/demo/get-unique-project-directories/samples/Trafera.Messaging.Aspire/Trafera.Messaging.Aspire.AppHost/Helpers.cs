using System.Net.NetworkInformation;

public static class AspireHelpers
{
    public static bool IsPortFree(int port)
    {
        return !IPGlobalProperties
            .GetIPGlobalProperties()
            .GetActiveTcpListeners()
            .Any(ep => ep.Port == port);
    }

    public static int GetClosestFreePort(int? startPort)
    {
        var startPortToUse = startPort ?? 5000;
        const int maxPort = 65535;
        for (int port = startPortToUse; port <= maxPort; port++)
        {
            if (IsPortFree(port))
            {
                return port;
            }
        }
        return -1;
    }

    public static int GetPort(int? desiredPort, int fallbackStartingPort = 5000)
    {
        return desiredPort.HasValue
            ? IsPortFree(desiredPort.Value)
                ? desiredPort.Value
                : GetClosestFreePort(desiredPort)
            : GetClosestFreePort(fallbackStartingPort);
    }
}
