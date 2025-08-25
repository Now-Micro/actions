using System.Collections.Immutable;
using System.Linq;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Demo.Analyzers;

[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class DisallowStringConcatAnalyzer : DiagnosticAnalyzer
{
    public const string DiagnosticId = "DA0002"; // Distinct from DA0001

    private static readonly LocalizableString Title =
        "Disallow string concatenation / string.Format (use interpolation)";
    private static readonly LocalizableString MessageFormat =
        $"Avoid string concatenation or string.Format; use string interpolation. ({Constants.CodeStandardsUrl})";
    private static readonly LocalizableString Description =
        "Enforces use of C# string interpolation instead of string concatenation or string.Format as demonstrated in CodingStandards examples.";
    private const string Category = "Style";

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
        context.RegisterSyntaxNodeAction(AnalyzeAddExpression, SyntaxKind.AddExpression);
        context.RegisterSyntaxNodeAction(AnalyzeInvocation, SyntaxKind.InvocationExpression);
    }

    private static void AnalyzeAddExpression(SyntaxNodeAnalysisContext context)
    {
        if (context.Node is not BinaryExpressionSyntax addExpr)
            return;

        // Only consider outermost string + expression to avoid duplicate nested diagnostics
        if (
            addExpr.Parent is BinaryExpressionSyntax parentBin
            && parentBin.IsKind(SyntaxKind.AddExpression)
        )
            return;

        var typeInfo = context.SemanticModel.GetTypeInfo(addExpr);
        if (typeInfo.ConvertedType?.SpecialType != SpecialType.System_String)
            return;

        // Skip if both sides are simple string literals (constant folding is fine to allow) – guideline focuses on variable interpolation
        bool leftLit = addExpr.Left is LiteralExpressionSyntax { Token.ValueText: not null };
        bool rightLit = addExpr.Right is LiteralExpressionSyntax { Token.ValueText: not null };
        if (leftLit && rightLit)
            return;

        // If inside an interpolated string, ignore (rare but protective)
        if (addExpr.Ancestors().OfType<InterpolatedStringExpressionSyntax>().Any())
            return;

        context.ReportDiagnostic(Diagnostic.Create(Rule, addExpr.GetLocation()));
    }

    private static void AnalyzeInvocation(SyntaxNodeAnalysisContext context)
    {
        if (context.Node is not InvocationExpressionSyntax invocation)
            return;
        if (invocation.Expression is not MemberAccessExpressionSyntax memberAccess)
        {
            var sym = context.SemanticModel.GetSymbolInfo(invocation).Symbol as IMethodSymbol;
            if (
                sym?.ContainingType?.SpecialType == SpecialType.System_String
                && sym.Name == "Format"
            )
            {
                context.ReportDiagnostic(Diagnostic.Create(Rule, invocation.GetLocation()));
            }
            return;
        }

        // Detect string.Format(...) via syntax OR symbol
        if (memberAccess.Name.Identifier.Text == "Format")
        {
            var targetSym = context.SemanticModel.GetSymbolInfo(invocation).Symbol as IMethodSymbol;
            if (targetSym?.ContainingType?.SpecialType == SpecialType.System_String)
            {
                context.ReportDiagnostic(Diagnostic.Create(Rule, invocation.GetLocation()));
                return;
            }
        }
    }
}
