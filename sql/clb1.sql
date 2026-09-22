/* ---------------------------------------------------------------------------
   Famicura Ring -> CLB1
   Spustit jednou na databázi CLB1. Aplikace tyto tabulky nezakládá; stávající
   SQL scénář je záměrně jen pro čtení a zakládat je nemůže.
   --------------------------------------------------------------------------- */

IF OBJECT_ID('dbo.FamicuraRingLog', 'U') IS NULL
CREATE TABLE dbo.FamicuraRingLog (
    Id           BIGINT IDENTITY(1,1) NOT NULL,
    Cas          DATETIME2(0)   NOT NULL,   -- kdy se to stalo
    KameraId     VARCHAR(256)   NULL,       -- ava1.ring.device....
    KameraNazev  NVARCHAR(200)  NULL,
    Druh         VARCHAR(40)    NULL,       -- state | fall | longlie | missing | found | abrupt
    Zavaznost    VARCHAR(20)    NULL,       -- info | varovani
    Popis        NVARCHAR(1000) NULL,
    OdZacatkuS   INT            NULL,       -- vteřiny od spuštění analýzy
    Zapsano      DATETIME2(0)   NOT NULL
        CONSTRAINT DF_FamicuraRingLog_Zapsano DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_FamicuraRingLog PRIMARY KEY CLUSTERED (Id)
);
GO

IF OBJECT_ID('dbo.FamicuraRingNahravky', 'U') IS NULL
CREATE TABLE dbo.FamicuraRingNahravky (
    Id           BIGINT IDENTITY(1,1) NOT NULL,
    Od           DATETIME2(0)   NOT NULL,
    Do           DATETIME2(0)   NULL,
    KameraId     VARCHAR(256)   NULL,
    KameraNazev  NVARCHAR(200)  NULL,
    VelikostB    BIGINT         NULL,
    Soubor       NVARCHAR(400)  NULL,       -- název souboru ve složce
    Slozka       NVARCHAR(400)  NULL,       -- Famicura-Camera; NULL = neuloženo
    Zdroj        VARCHAR(20)    NULL,       -- plan | rucne
    Zapsano      DATETIME2(0)   NOT NULL
        CONSTRAINT DF_FamicuraRingNahravky_Zapsano DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_FamicuraRingNahravky PRIMARY KEY CLUSTERED (Id)
);
GO

/* Dotazy chodí skoro vždy přes čas, případně přes kameru. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FamicuraRingLog_Cas')
    CREATE INDEX IX_FamicuraRingLog_Cas ON dbo.FamicuraRingLog (Cas DESC) INCLUDE (KameraNazev, Druh);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FamicuraRingNahravky_Od')
    CREATE INDEX IX_FamicuraRingNahravky_Od ON dbo.FamicuraRingNahravky (Od DESC) INCLUDE (KameraNazev);
GO

/* Ukázka: pády a dlouhá ležení za posledních 7 dní i s nahrávkou, která je pokrývá. */
-- SELECT l.Cas, l.KameraNazev, l.Druh, l.Popis, n.Slozka, n.Soubor
-- FROM dbo.FamicuraRingLog AS l
-- LEFT JOIN dbo.FamicuraRingNahravky AS n
--        ON n.KameraId = l.KameraId AND l.Cas BETWEEN n.Od AND ISNULL(n.Do, n.Od)
-- WHERE l.Druh IN ('fall', 'longlie') AND l.Cas >= DATEADD(DAY, -7, SYSDATETIME())
-- ORDER BY l.Cas DESC;
