using System.Collections.Immutable;
using System.Linq; // added for OfType
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Demo.Analyzers;

[DiagnosticAnalyzer(LanguageNames.CSharp)]
public class AwaitInLoopAnalyzer : DiagnosticAnalyzer
{
    public const string DiagnosticId = "DA0001";
    private static readonly LocalizableString Title = "Avoid await inside loop";
    private static readonly LocalizableString MessageFormat =
        $"'await' used inside loop; consider collecting tasks and awaiting Task.WhenAll;  ({Constants.CodeStandardsUrl})";
    private static readonly LocalizableString Description =
        "Using await inside a loop causes serial execution."; // ensure period
    private const string Category = "Performance";

    private static readonly DiagnosticDescriptor Rule = new(
        DiagnosticId,
        Title,
        MessageFormat,
        Category,
        DiagnosticSeverity.Error,
        isEnabledByDefault: true,
        description: Description
    );

    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics =>
        ImmutableArray.Create(Rule);

    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();
        context.RegisterSyntaxNodeAction(
            AnalyzeLoop,
            SyntaxKind.ForStatement,
            SyntaxKind.ForEachStatement,
            SyntaxKind.ForEachVariableStatement,
            SyntaxKind.WhileStatement,
            SyntaxKind.DoStatement
        );
    }

    private static void AnalyzeLoop(SyntaxNodeAnalysisContext context)
    {
        if (context.Node is not StatementSyntax stmt)
            return;
        foreach (var awaitExpr in stmt.DescendantNodes().OfType<AwaitExpressionSyntax>())
        {
            context.ReportDiagnostic(Diagnostic.Create(Rule, awaitExpr.GetLocation()));
        }
    }
}
